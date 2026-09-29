package main

import (
	"fmt"
	"log/slog"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron"
	"github.com/smartcontractkit/cre-sdk-go/cre"
)

// Config is loaded from config.<target>.json.
type Config struct {
	Schedule         string `json:"schedule"`
	ChainName        string `json:"chainName"`
	MetronomeAddress string `json:"metronomeAddress"`
	HeartbeatAddress string `json:"heartbeatAddress"` // MetronomeHeartbeat receiver
	GasLimit         uint64 `json:"gasLimit"`
}

type ExecutionResult struct {
	Status  string `json:"status"` // "idle" or "settled"
	Pending uint64 `json:"pending,omitempty"`
	Through uint64 `json:"through,omitempty"`
	TxHash  string `json:"txHash,omitempty"`
}

// nextPendingBatch() on Metronome: oldest batch with orders that isn't settled yet, or 0.
var nextPendingBatchSelector = common.FromHex("0x98ff3072")

var uint256Args = func() abi.Arguments {
	t, err := abi.NewType("uint256", "", nil)
	if err != nil {
		panic(err)
	}
	return abi.Arguments{{Type: t}}
}()

func InitWorkflow(config *Config, logger *slog.Logger, secretsProvider cre.SecretsProvider) (cre.Workflow[*Config], error) {
	return cre.Workflow[*Config]{
		cre.Handler(cron.Trigger(&cron.Config{Schedule: config.Schedule}), onCronTrigger),
	}, nil
}

func onCronTrigger(config *Config, runtime cre.Runtime, trigger *cron.Payload) (*ExecutionResult, error) {
	logger := runtime.Logger()

	selector, err := evm.ChainSelectorFromName(config.ChainName)
	if err != nil {
		return nil, err
	}
	client := &evm.Client{ChainSelector: selector}

	// 1. Is any batch waiting? One view call, so idle ticks cost no gas.
	reply, err := client.CallContract(runtime, &evm.CallContractRequest{
		Call: &evm.CallMsg{
			To:   common.HexToAddress(config.MetronomeAddress).Bytes(),
			Data: nextPendingBatchSelector,
		},
	}).Await()
	if err != nil {
		return nil, fmt.Errorf("nextPendingBatch: %w", err)
	}
	out, err := uint256Args.Unpack(reply.Data)
	if err != nil {
		return nil, fmt.Errorf("decode nextPendingBatch: %w", err)
	}
	pending := out[0].(*big.Int)
	if pending.Sign() == 0 {
		logger.Info("No pending batch")
		return &ExecutionResult{Status: "idle"}, nil
	}

	// 2. Settle through the latest block we can see. Every batch up to it has closed by the time the report lands,
	// so one report catches up on everything pending instead of one batch per tick.
	head, err := client.HeaderByNumber(runtime, &evm.HeaderByNumberRequest{}).Await()
	if err != nil {
		return nil, fmt.Errorf("latest header: %w", err)
	}
	through := new(big.Int).SetBytes(head.Header.BlockNumber.AbsVal)
	if through.Cmp(pending) < 0 {
		through = pending
	}
	logger.Info("Pending batch found", "pending", pending, "through", through)

	payload, err := uint256Args.Pack(through)
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

	// 3. The forwarder checks the DON's signatures and calls MetronomeHeartbeat.onReport, which calls settle.
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
		return nil, fmt.Errorf("settle tx failed (%v): %s", resp.TxStatus, msg)
	}
	if resp.ReceiverContractExecutionStatus != nil &&
		*resp.ReceiverContractExecutionStatus != evm.ReceiverContractExecutionStatus_RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS {
		return nil, fmt.Errorf("MetronomeHeartbeat.onReport reverted")
	}

	tx := common.BytesToHash(resp.TxHash).Hex()
	logger.Info("Settled", "through", through, "txHash", tx)
	return &ExecutionResult{Status: "settled", Pending: pending.Uint64(), Through: through.Uint64(), TxHash: tx}, nil
}
