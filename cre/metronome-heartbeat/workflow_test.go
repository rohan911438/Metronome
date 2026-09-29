package main

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/smartcontractkit/chainlink-protos/cre/go/values/pb"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	evmmock "github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm/mock"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron"
	"github.com/smartcontractkit/cre-sdk-go/cre"
	"github.com/smartcontractkit/cre-sdk-go/cre/testutils"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var testConfig = &Config{
	Schedule:         "*/30 * * * * *",
	ChainName:        "monad-testnet",
	MetronomeAddress: "0x32f11865b2272B24f0F8174598EA64A82fc63761",
	HeartbeatAddress: "0xAe2C3113aF7C897DAcc456Dc78234724179d27F4",
	GasLimit:         1_500_000,
}

var tick = &cron.Payload{ScheduledExecutionTime: timestamppb.New(time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC))}

// newChain mocks Monad testnet: nextPendingBatch() returns pending, the latest block is head, and every report
// written is recorded. writeStatus decides whether onReport succeeds.
func newChain(t *testing.T, pending, head int64, onReportOK bool) *[][]byte {
	selector, err := evm.ChainSelectorFromName(testConfig.ChainName)
	require.NoError(t, err)
	chain, err := evmmock.NewClientCapability(selector, t)
	require.NoError(t, err)

	chain.CallContract = func(_ context.Context, in *evm.CallContractRequest) (*evm.CallContractReply, error) {
		require.Equal(t, common.HexToAddress(testConfig.MetronomeAddress).Bytes(), in.Call.To)
		require.Equal(t, nextPendingBatchSelector, in.Call.Data)
		out, err := uint256Args.Pack(big.NewInt(pending))
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

func TestInitWorkflow(t *testing.T) {
	runtime := testutils.NewRuntime(t, testutils.Secrets{})
	workflow, err := InitWorkflow(testConfig, runtime.Logger(), nil)
	require.NoError(t, err)
	require.Len(t, workflow, 1)
	require.Equal(t, cron.Trigger(&cron.Config{}).CapabilityID(), workflow[0].CapabilityID())
}

func TestIdleTickWritesNothing(t *testing.T) {
	reports := newChain(t, 0, 1000, true)
	runtime := testutils.NewRuntime(t, testutils.Secrets{})

	res, err := onCronTrigger(testConfig, runtime, tick)
	require.NoError(t, err)
	require.Equal(t, "idle", res.Status)
	require.Empty(t, *reports)
}

func TestPendingBatchSettlesThroughHead(t *testing.T) {
	reports := newChain(t, 990, 1000, true)
	runtime := testutils.NewRuntime(t, testutils.Secrets{})

	res, err := onCronTrigger(testConfig, runtime, tick)
	require.NoError(t, err)
	require.Equal(t, "settled", res.Status)
	require.EqualValues(t, 990, res.Pending)
	require.EqualValues(t, 1000, res.Through)
	require.Len(t, *reports, 1)
	want, _ := uint256Args.Pack(big.NewInt(1000))
	require.Equal(t, want, (*reports)[0])
}

func TestRevertedReceiverIsAnError(t *testing.T) {
	newChain(t, 990, 1000, false)
	runtime := testutils.NewRuntime(t, testutils.Secrets{})

	_, err := onCronTrigger(testConfig, runtime, tick)
	require.ErrorContains(t, err, "onReport reverted")
}
