package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"math/big"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron"
	"github.com/smartcontractkit/cre-sdk-go/cre"
)

// Config is loaded from config.<target>.json.
type Config struct {
	Schedule         string `json:"schedule"`
	ChainName        string `json:"chainName"`
	MetronomeAddress string `json:"metronomeAddress"`
	HeartbeatAddress string `json:"heartbeatAddress"` // MetronomeHeartbeat receiver, also the market's price feed
	GasLimit         uint64 `json:"gasLimit"`
	// PriceURL returns MON/USD the way Coinbase's spot endpoint does: {"data":{"amount":"0.0316"}}.
	PriceURL string `json:"priceUrl"`
	// PriceMaxAgeSec: with no batch waiting, send a price-only report once the on-chain price is this old.
	PriceMaxAgeSec int64 `json:"priceMaxAgeSec"`
}

type ExecutionResult struct {
	Status  string `json:"status"` // "idle", "price" or "settled"
	Pending uint64 `json:"pending,omitempty"`
	Through uint64 `json:"through,omitempty"`
	PriceE8 int64  `json:"priceE8,omitempty"`
	TxHash  string `json:"txHash,omitempty"`
}

var (
	// nextPendingBatch() on Metronome: oldest batch with orders that isn't settled yet, or 0.
	nextPendingBatchSelector = common.FromHex("0x98ff3072")
	// priceUpdatedAt() on MetronomeHeartbeat: when the stored price was observed (unix seconds), 0 if never.
	priceUpdatedAtSelector = common.FromHex("0xb11c4eec")
)

func mustType(s string) abi.Type {
	t, err := abi.NewType(s, "", nil)
	if err != nil {
		panic(err)
	}
	return t
}

var (
	uint256Args = abi.Arguments{{Type: mustType("uint256")}}
	// What MetronomeHeartbeat.onReport decodes: (batchId, MON/USD with 8 decimals, observedAt).
	reportArgs = abi.Arguments{{Type: mustType("uint256")}, {Type: mustType("int256")}, {Type: mustType("uint256")}}
)

func InitWorkflow(config *Config, logger *slog.Logger, secretsProvider cre.SecretsProvider) (cre.Workflow[*Config], error) {
	return cre.Workflow[*Config]{
		cre.Handler(cron.Trigger(&cron.Config{Schedule: config.Schedule}), onCronTrigger),
	}, nil
}

func readUint(runtime cre.Runtime, client *evm.Client, to string, selector []byte) (*big.Int, error) {
	reply, err := client.CallContract(runtime, &evm.CallContractRequest{
		Call: &evm.CallMsg{To: common.HexToAddress(to).Bytes(), Data: selector},
	}).Await()
	if err != nil {
		return nil, err
	}
	out, err := uint256Args.Unpack(reply.Data)
	if err != nil {
		return nil, err
	}
	return out[0].(*big.Int), nil
}

// fetchPrice runs on every node: GET the price API and return MON/USD with 8 decimals. The DON takes the median.
func fetchPrice(config *Config, logger *slog.Logger, sendRequester *http.SendRequester) (int64, error) {
	resp, err := sendRequester.SendRequest(&http.Request{Url: config.PriceURL, Method: "GET"}).Await()
	if err != nil {
		return 0, err
	}
	if resp.StatusCode != 200 {
		return 0, fmt.Errorf("price API returned %d", resp.StatusCode)
	}
	var body struct {
		Data struct {
			Amount string `json:"amount"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resp.Body, &body); err != nil {
		return 0, fmt.Errorf("decode price: %w", err)
	}
	usd, err := strconv.ParseFloat(body.Data.Amount, 64)
	if err != nil || usd <= 0 || math.IsInf(usd, 0) || math.IsNaN(usd) {
		return 0, fmt.Errorf("bad price %q", body.Data.Amount)
	}
	return int64(math.Round(usd * 1e8)), nil
}

func onCronTrigger(config *Config, runtime cre.Runtime, trigger *cron.Payload) (*ExecutionResult, error) {
	logger := runtime.Logger()

	selector, err := evm.ChainSelectorFromName(config.ChainName)
	if err != nil {
		return nil, err
	}
	client := &evm.Client{ChainSelector: selector}

	// 1. Is a batch waiting, and is the on-chain price getting old? Two view calls, so idle ticks cost no gas.
	pending, err := readUint(runtime, client, config.MetronomeAddress, nextPendingBatchSelector)
	if err != nil {
		return nil, fmt.Errorf("nextPendingBatch: %w", err)
	}
	updatedAt, err := readUint(runtime, client, config.HeartbeatAddress, priceUpdatedAtSelector)
	if err != nil {
		return nil, fmt.Errorf("priceUpdatedAt: %w", err)
	}
	now := runtime.Now()
	priceStale := now.Unix()-updatedAt.Int64() >= config.PriceMaxAgeSec
	if pending.Sign() == 0 && !priceStale {
		logger.Info("No pending batch, price fresh")
		return &ExecutionResult{Status: "idle"}, nil
	}

	// 2. MON/USD from the off-chain API, median across the DON. A failed fetch must not stop settlement: report price 0,
	// which the receiver ignores (the market's guard then judges the batch on the last stored price).
	price, err := http.SendRequest(config, runtime, &http.Client{}, fetchPrice, cre.ConsensusMedianAggregation[int64]()).Await()
	if err != nil {
		logger.Warn("Price fetch failed; reporting without a new price", "err", err)
		price = 0
	}
	// Stamp the observation slightly in the past: the receiver ignores prices dated after its block's timestamp.
	observedAt := now.Add(-2 * time.Second).Unix()

	// 3. Settle through the latest block we can see. Every batch up to it has closed by the time the report lands,
	// so one report catches up on everything pending instead of one batch per tick. No batch: a price-only report.
	through := new(big.Int)
	switch {
	case pending.Sign() != 0:
		head, err := client.HeaderByNumber(runtime, &evm.HeaderByNumberRequest{}).Await()
		if err != nil {
			return nil, fmt.Errorf("latest header: %w", err)
		}
		through.SetBytes(head.Header.BlockNumber.AbsVal)
		if through.Cmp(pending) < 0 {
			through.Set(pending)
		}
		logger.Info("Pending batch found", "pending", pending, "through", through, "priceE8", price)
	case price == 0:
		return &ExecutionResult{Status: "idle"}, nil
	default:
		logger.Info("Refreshing price", "priceE8", price)
	}

	payload, err := reportArgs.Pack(through, big.NewInt(price), big.NewInt(observedAt))
	if err != nil {
		return nil, err
	}
	report, err := runtime.GenerateReport(&cre.ReportRequest{
		EncodedPayload: payload,
		EncoderName:    "evm",
		SigningAlgo:    "ecdsa",
		HashingAlgo:    "keccak256",
	}).Await()
	if err != nil {
		return nil, fmt.Errorf("generate report: %w", err)
	}

	// 4. The forwarder checks the DON's signatures and calls MetronomeHeartbeat.onReport, which stores the price and
	// calls settle.
	resp, err := client.WriteReport(runtime, &evm.WriteCreReportRequest{
		Receiver:  common.HexToAddress(config.HeartbeatAddress).Bytes(),
		Report:    report,
		GasConfig: &evm.GasConfig{GasLimit: config.GasLimit},
	}).Await()
	if err != nil {
		return nil, fmt.Errorf("write report: %w", err)
	}
	if resp.TxStatus != evm.TxStatus_TX_STATUS_SUCCESS {
		msg := "unknown error"
		if resp.ErrorMessage != nil {
			msg = *resp.ErrorMessage
		}
		return nil, fmt.Errorf("report tx failed (%v): %s", resp.TxStatus, msg)
	}
	if resp.ReceiverContractExecutionStatus != nil &&
		*resp.ReceiverContractExecutionStatus != evm.ReceiverContractExecutionStatus_RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS {
		return nil, fmt.Errorf("MetronomeHeartbeat.onReport reverted")
	}

	tx := common.BytesToHash(resp.TxHash).Hex()
	status := "settled"
	if pending.Sign() == 0 {
		status = "price"
	}
	logger.Info("Report written", "status", status, "through", through, "priceE8", price, "txHash", tx)
	return &ExecutionResult{Status: status, Pending: pending.Uint64(), Through: through.Uint64(), PriceE8: price, TxHash: tx}, nil
}
