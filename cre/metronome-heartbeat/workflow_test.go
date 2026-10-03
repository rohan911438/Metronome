package main

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/smartcontractkit/chainlink-protos/cre/go/values/pb"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	evmmock "github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm/mock"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	httpmock "github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http/mock"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron"
	"github.com/smartcontractkit/cre-sdk-go/cre"
	"github.com/smartcontractkit/cre-sdk-go/cre/testutils"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var testConfig = &Config{
	Schedule:         "*/30 * * * * *",
	ChainName:        "monad-testnet",
	MetronomeAddress: "0x99E4DBCF8edE8092Be972307eB3d0Cd91ecBa889",
	HeartbeatAddress: "0x99758F4e8Ce8E9A5364d1a6aBc2a7cF40ac9874f",
	GasLimit:         1_500_000,
	PriceURL:         "https://api.coinbase.com/v2/prices/MON-USD/spot",
	PriceMaxAgeSec:   300,
}

var (
	now  = time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	tick = &cron.Payload{ScheduledExecutionTime: timestamppb.New(now)}
)

// newChain mocks Monad testnet: nextPendingBatch() returns pending, priceUpdatedAt() returns updatedAt, the latest
// block is head, and every report written is recorded. onReportOK decides whether onReport succeeds.
func newChain(t *testing.T, pending, updatedAt, head int64, onReportOK bool) *[][]byte {
	selector, err := evm.ChainSelectorFromName(testConfig.ChainName)
	require.NoError(t, err)
	chain, err := evmmock.NewClientCapability(selector, t)
	require.NoError(t, err)

	chain.CallContract = func(_ context.Context, in *evm.CallContractRequest) (*evm.CallContractReply, error) {
		var v int64
		switch {
		case common.BytesToAddress(in.Call.To) == common.HexToAddress(testConfig.MetronomeAddress) &&
			common.Bytes2Hex(in.Call.Data) == common.Bytes2Hex(nextPendingBatchSelector):
			v = pending
		case common.BytesToAddress(in.Call.To) == common.HexToAddress(testConfig.HeartbeatAddress) &&
			common.Bytes2Hex(in.Call.Data) == common.Bytes2Hex(priceUpdatedAtSelector):
			v = updatedAt
		default:
			t.Fatalf("unexpected call to %x: %x", in.Call.To, in.Call.Data)
		}
		out, err := uint256Args.Pack(big.NewInt(v))
		require.NoError(t, err)
		return &evm.CallContractReply{Data: out}, nil
	}
	chain.HeaderByNumber = func(_ context.Context, _ *evm.HeaderByNumberRequest) (*evm.HeaderByNumberReply, error) {
		return &evm.HeaderByNumberReply{Header: &evm.Header{BlockNumber: pb.NewBigIntFromInt(big.NewInt(head))}}, nil
	}
	var reports [][]byte
	chain.WriteReport = func(_ context.Context, in *evm.WriteReportRequest) (*evm.WriteReportReply, error) {
		require.Equal(t, common.HexToAddress(testConfig.HeartbeatAddress).Bytes(), in.Receiver)
		require.Equal(t, testConfig.GasLimit, in.GasConfig.GasLimit)
		reports = append(reports, in.Report.RawReport[cre.ReportMetadataHeaderLength:])
		status := evm.ReceiverContractExecutionStatus_RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS
		if !onReportOK {
			status = evm.ReceiverContractExecutionStatus_RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED
		}
		return &evm.WriteReportReply{
			TxStatus:                        evm.TxStatus_TX_STATUS_SUCCESS,
			ReceiverContractExecutionStatus: &status,
			TxHash:                          common.HexToHash("0x02").Bytes(),
		}, nil
	}
	return &reports
}

// newPriceAPI mocks the price endpoint. A non-empty errMsg makes every request fail. Returns the request count.
func newPriceAPI(t *testing.T, body string, errMsg string) *int {
	api, err := httpmock.NewClientCapability(t)
	require.NoError(t, err)
	calls := 0
	api.SendRequest = func(_ context.Context, in *http.Request) (*http.Response, error) {
		calls++
		require.Equal(t, testConfig.PriceURL, in.Url)
		require.Equal(t, "GET", in.Method)
		if errMsg != "" {
			return nil, errors.New(errMsg)
		}
		return &http.Response{StatusCode: 200, Body: []byte(body)}, nil
	}
	return &calls
}

func newRuntime(t *testing.T) *testutils.TestRuntime {
	runtime := testutils.NewRuntime(t, testutils.Secrets{})
	runtime.SetTimeProvider(func() time.Time { return now })
	return runtime
}

func wantReport(t *testing.T, through, price int64) []byte {
	b, err := reportArgs.Pack(big.NewInt(through), big.NewInt(price), big.NewInt(now.Unix()-2))
	require.NoError(t, err)
	return b
}

const coinbaseBody = `{"data":{"amount":"0.0315885","base":"MON","currency":"USD"}}`

func TestInitWorkflow(t *testing.T) {
	runtime := testutils.NewRuntime(t, testutils.Secrets{})
	workflow, err := InitWorkflow(testConfig, runtime.Logger(), nil)
	require.NoError(t, err)
	require.Len(t, workflow, 1)
	require.Equal(t, cron.Trigger(&cron.Config{}).CapabilityID(), workflow[0].CapabilityID())
}

func TestIdleTickWritesNothing(t *testing.T) {
	reports := newChain(t, 0, now.Unix()-60, 1000, true) // price a minute old
	calls := newPriceAPI(t, coinbaseBody, "")

	res, err := onCronTrigger(testConfig, newRuntime(t), tick)
	require.NoError(t, err)
	require.Equal(t, "idle", res.Status)
	require.Empty(t, *reports)
	require.Zero(t, *calls) // no API call either
}

func TestPendingBatchSettlesThroughHeadWithPrice(t *testing.T) {
	reports := newChain(t, 990, now.Unix()-60, 1000, true)
	newPriceAPI(t, coinbaseBody, "")

	res, err := onCronTrigger(testConfig, newRuntime(t), tick)
	require.NoError(t, err)
	require.Equal(t, "settled", res.Status)
	require.EqualValues(t, 990, res.Pending)
	require.EqualValues(t, 1000, res.Through)
	require.EqualValues(t, 3_158_850, res.PriceE8)
	require.Len(t, *reports, 1)
	require.Equal(t, wantReport(t, 1000, 3_158_850), (*reports)[0])
}

func TestStalePriceSendsPriceOnlyReport(t *testing.T) {
	reports := newChain(t, 0, now.Unix()-301, 1000, true)
	newPriceAPI(t, coinbaseBody, "")

	res, err := onCronTrigger(testConfig, newRuntime(t), tick)
	require.NoError(t, err)
	require.Equal(t, "price", res.Status)
	require.Len(t, *reports, 1)
	require.Equal(t, wantReport(t, 0, 3_158_850), (*reports)[0])
}

func TestPriceOutageStillSettles(t *testing.T) {
	reports := newChain(t, 990, 0, 1000, true)
	newPriceAPI(t, "", "connection refused")

	res, err := onCronTrigger(testConfig, newRuntime(t), tick)
	require.NoError(t, err)
	require.Equal(t, "settled", res.Status)
	require.Zero(t, res.PriceE8)
	require.Equal(t, wantReport(t, 1000, 0), (*reports)[0])
}

func TestPriceOutageWithNothingPendingIsIdle(t *testing.T) {
	reports := newChain(t, 0, 0, 1000, true)
	newPriceAPI(t, `{"data":{"amount":"not a number"}}`, "")

	res, err := onCronTrigger(testConfig, newRuntime(t), tick)
	require.NoError(t, err)
	require.Equal(t, "idle", res.Status)
	require.Empty(t, *reports)
}

func TestRevertedReceiverIsAnError(t *testing.T) {
	newChain(t, 990, 0, 1000, false)
	newPriceAPI(t, coinbaseBody, "")

	_, err := onCronTrigger(testConfig, newRuntime(t), tick)
	require.ErrorContains(t, err, "onReport reverted")
}
