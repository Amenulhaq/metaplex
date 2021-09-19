import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import Countdown from 'react-countdown';
import {
  CircularProgress,
  Container,
  IconButton,
  Link,
  Slider,
  Snackbar,
} from '@material-ui/core';
import Button from '@material-ui/core/Button';
import Paper from '@material-ui/core/Paper';
import Typography from '@material-ui/core/Typography';
import Grid from '@material-ui/core/Grid';
import { createStyles, Theme, withStyles } from '@material-ui/core/styles';
import Backdrop from '@material-ui/core/Backdrop';
import { PhaseCountdown } from './countdown';
import Dialog from '@material-ui/core/Dialog';
import MuiDialogTitle from '@material-ui/core/DialogTitle';
import MuiDialogContent from '@material-ui/core/DialogContent';
import CloseIcon from '@material-ui/icons/Close';

import Alert from '@material-ui/lab/Alert';

import * as anchor from '@project-serum/anchor';

import { LAMPORTS_PER_SOL } from '@solana/web3.js';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletDialogButton } from '@solana/wallet-adapter-material-ui';

import {
  awaitTransactionSignatureConfirmation,
  CandyMachineAccount,
  getCandyMachineState,
  mintOneToken,
  shortenAddress,
} from './candy-machine';

import {
  FairLaunchAccount,
  FairLaunchTicket,
  getFairLaunchLotteryBitmap,
  getFairLaunchState,
  punchTicket,
  purchaseTicket,
  withdrawFunds,
} from './fair-launch';

import { formatNumber, toDate } from './utils';

const ConnectButton = styled(WalletDialogButton)``;

const CounterText = styled.span``; // add your styles here

const MintContainer = styled.div``; // add your styles here

const MintButton = styled(Button)`
  width: 100%;
  height: 60px;
  margin-top: 10px;
  margin-bottom: 5px;
  background: linear-gradient(180deg, #604ae5 0%, #813eee 100%);
  color: white;
  font-size: 16px;
  font-weight: bold;
`; // add your styles here

const dialogStyles: any = (theme: Theme) =>
  createStyles({
    root: {
      margin: 0,
      padding: theme.spacing(2),
    },
    closeButton: {
      position: 'absolute',
      right: theme.spacing(1),
      top: theme.spacing(1),
      color: theme.palette.grey[500],
    },
  });

const ValueSlider = styled(Slider)({
  color: '#C0D5FE',
  height: 8,
  '& > *': {
    height: 4,
  },
  '& .MuiSlider-track': {
    border: 'none',
    height: 4,
  },
  '& .MuiSlider-thumb': {
    height: 24,
    width: 24,
    marginTop: -10,
    background: 'linear-gradient(180deg, #604AE5 0%, #813EEE 100%)',
    border: '2px solid currentColor',
    '&:focus, &:hover, &.Mui-active, &.Mui-focusVisible': {
      boxShadow: 'inherit',
    },
    '&:before': {
      display: 'none',
    },
  },
  '& .MuiSlider-valueLabel': {
    '& > *': {
      background: 'linear-gradient(180deg, #604AE5 0%, #813EEE 100%)',
    },
    lineHeight: 1.2,
    fontSize: 12,
    padding: 0,
    width: 32,
    height: 32,
    marginLeft: 9,
  },
});

const LimitedBackdrop = withStyles({
  root: {
    position: 'absolute',
    zIndex: 1,
  },
})(Backdrop);

enum Phase {
  Phase0,
  Phase1,
  Phase2,
  Lottery,
  Phase3,
  Phase4,
  Unknown,
}

const Header = (props: {
  phaseName: string;
  desc: string;
  date: anchor.BN | undefined;
}) => {
  const { phaseName, desc, date } = props;
  return (
    <Grid container justifyContent="center">
      <Grid xs={6} justifyContent="center" direction="column">
        <Typography variant="h5">{phaseName}</Typography>
        <Typography variant="body1" color="textSecondary">
          {desc}
        </Typography>
      </Grid>
      <Grid xs={6} container justifyContent="flex-end">
        <PhaseCountdown
          date={toDate(date)}
          style={{ justifyContent: 'flex-end' }}
          status="COMPLETE"
        />
      </Grid>
    </Grid>
  );
};

function getPhase(
  fairLaunch: FairLaunchAccount | undefined,
  candyMachine: CandyMachineAccount | undefined,
): Phase {
  const curr = new Date().getTime();

  const phaseOne = toDate(fairLaunch?.state.data.phaseOneStart)?.getTime();
  const phaseOneEnd = toDate(fairLaunch?.state.data.phaseOneEnd)?.getTime();
  const phaseTwoEnd = toDate(fairLaunch?.state.data.phaseTwoEnd)?.getTime();
  const candyMachineGoLive = toDate(candyMachine?.state.goLiveDate)?.getTime();

  if (phaseOne && curr < phaseOne) {
    return Phase.Phase0;
  } else if (phaseOneEnd && curr <= phaseOneEnd) {
    return Phase.Phase1;
  } else if (phaseTwoEnd && curr <= phaseTwoEnd) {
    return Phase.Phase2;
  } else if (!fairLaunch?.state.phaseThreeStarted) {
    return Phase.Lottery;
  } else if (
    fairLaunch?.state.phaseThreeStarted &&
    candyMachineGoLive &&
    curr > candyMachineGoLive
  ) {
    return Phase.Phase4;
  }

  return Phase.Unknown;
}

export interface HomeProps {
  candyMachineId: anchor.web3.PublicKey;
  fairLaunchId: anchor.web3.PublicKey;
  config: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  startDate: number;
  treasury: anchor.web3.PublicKey;
  txTimeout: number;
}

const FAIR_LAUNCH_LOTTERY_SIZE =
  8 + // discriminator
  32 + // fair launch
  1 + // bump
  8; // size of bitmask ones

const isWinner = (fairLaunch: FairLaunchAccount | undefined): boolean => {
  if (
    !fairLaunch?.lottery.data ||
    !fairLaunch?.lottery.data.length ||
    !fairLaunch?.ticket.data?.seq ||
    !fairLaunch?.state.phaseThreeStarted
  ) {
    return false;
  }

  const myByte =
    fairLaunch.lottery.data[
      FAIR_LAUNCH_LOTTERY_SIZE +
        Math.floor(fairLaunch.ticket.data?.seq.toNumber() / 8)
    ];

  const positionFromRight = 7 - (fairLaunch.ticket.data?.seq.toNumber() % 8);
  const mask = Math.pow(2, positionFromRight);
  const isWinner = myByte & mask;
  return isWinner > 0;
};

enum LotteryState {
  Brewing = 'Brewing',
  Finished = 'Finished',
  PastDue = 'Past Due',
}

const getLotteryState = (
  phaseThree: boolean | undefined,
  lottery: Uint8Array | null,
  lotteryDuration: anchor.BN,
  phaseTwoEnd: anchor.BN,
): LotteryState => {
  if (
    !phaseThree &&
    (!lottery || lottery.length === 0) &&
    phaseTwoEnd.add(lotteryDuration).lt(new anchor.BN(Date.now() / 1000))
  ) {
    return LotteryState.PastDue;
  } else if (phaseThree) {
    return LotteryState.Finished;
  } else {
    return LotteryState.Brewing;
  }
};

const Home = (props: HomeProps) => {
  const [balance, setBalance] = useState<number>();
  const [isMinting, setIsMinting] = useState(false); // true when user got to press MINT
  const [contributed, setContributed] = useState(0);

  const wallet = useWallet();

  const anchorWallet = useMemo(() => {
    if (
      !wallet ||
      !wallet.publicKey ||
      !wallet.signAllTransactions ||
      !wallet.signTransaction
    ) {
      return;
    }

    return {
      publicKey: wallet.publicKey,
      signAllTransactions: wallet.signAllTransactions,
      signTransaction: wallet.signTransaction,
    } as anchor.Wallet;
  }, [wallet, wallet.publicKey]);

  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: '',
    severity: undefined,
  });

  const [fairLaunch, setFairLaunch] = useState<FairLaunchAccount>();
  const [candyMachine, setCandyMachine] = useState<CandyMachineAccount>();
  const [howToOpen, setHowToOpen] = useState(false);

  const onMint = async () => {
    try {
      setIsMinting(true);
      if (wallet.connected && candyMachine?.program && wallet.publicKey) {
        const mintTxId = await mintOneToken(
          candyMachine,
          props.config,
          wallet.publicKey,
          props.treasury,
        );

        const status = await awaitTransactionSignatureConfirmation(
          mintTxId,
          props.txTimeout,
          props.connection,
          'singleGossip',
          false,
        );

        if (!status?.err) {
          setAlertState({
            open: true,
            message: 'Congratulations! Mint succeeded!',
            severity: 'success',
          });
        } else {
          setAlertState({
            open: true,
            message: 'Mint failed! Please try again!',
            severity: 'error',
          });
        }
      }
    } catch (error: any) {
      // TODO: blech:
      let message = error.msg || 'Minting failed! Please try again!';
      if (!error.msg) {
        if (error.message.indexOf('0x138')) {
        } else if (error.message.indexOf('0x137')) {
          message = `SOLD OUT!`;
        } else if (error.message.indexOf('0x135')) {
          message = `Insufficient funds to mint. Please fund your wallet.`;
        }
      } else {
        if (error.code === 311) {
          message = `SOLD OUT!`;
          window.location.reload();
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`;
        }
      }

      setAlertState({
        open: true,
        message,
        severity: 'error',
      });
    } finally {
      if (wallet?.publicKey) {
        const balance = await props.connection.getBalance(wallet?.publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
      }
      setIsMinting(false);
    }
  };

  useEffect(() => {
    (async () => {
      if (anchorWallet?.publicKey) {
        try {
          const balance = await props.connection.getBalance(
            anchorWallet.publicKey,
          );
          setBalance(balance / LAMPORTS_PER_SOL);
        } catch {
          // ignore connection error
        }
      }
    })();
  }, [anchorWallet, props.connection]);

  useEffect(() => {
    (async () => {
      if (!anchorWallet) {
        return;
      }

      try {
        const state = await getFairLaunchState(
          anchorWallet,
          props.fairLaunchId,
          props.connection,
        );

        setFairLaunch(state);
      } catch (e) {
        console.log('Problem getting fair launch state');
        console.log(e);
      }

      try {
        const cndy = await getCandyMachineState(
          anchorWallet,
          props.candyMachineId,
          props.connection,
        );
        setCandyMachine(cndy);
      } catch {
        console.log('Problem getting candy machine state');
      }
    })();
  }, [anchorWallet, props.candyMachineId, props.connection]);

  const min = formatNumber.asNumber(fairLaunch?.state.data.priceRangeStart);
  const max = formatNumber.asNumber(fairLaunch?.state.data.priceRangeEnd);
  const step = formatNumber.asNumber(fairLaunch?.state.data.tickSize);
  const median = formatNumber.asNumber(fairLaunch?.state.currentMedian);
  const marks = [
    {
      value: min || 0,
      label: `${min} SOL`,
    },
    // TODO:L
    {
      value: median || 0,
      label: `${median}`,
    },
    // display user comitted value
    // {
    //   value: 37,
    //   label: '37°C',
    // },
    {
      value: max || 0,
      label: `${max} SOL`,
    },
  ].filter(_ => _ !== undefined && _.value !== 0) as any;

  const onDeposit = () => {
    if (!anchorWallet) {
      return;
    }

    console.log('deposit');

    purchaseTicket(contributed, anchorWallet, fairLaunch);
  };

  const onRefundTicket = () => {
    if (!anchorWallet) {
      return;
    }

    console.log('refund');

    purchaseTicket(0, anchorWallet, fairLaunch);
  };

  const onPunchTicket = () => {
    if (!anchorWallet || !fairLaunch || !fairLaunch.ticket) {
      return;
    }

    console.log('punch');

    punchTicket(anchorWallet, fairLaunch);
  };

  const onWithdraw = () => {
    if (!anchorWallet) {
      return;
    }

    console.log('withdraw');

    withdrawFunds(anchorWallet, fairLaunch);
  };

  const phase = getPhase(fairLaunch, candyMachine);

  return (
    <Container style={{ marginTop: 100 }}>
      <Container maxWidth="sm" style={{ position: 'relative' }}>
        {/* Display timer before the drop */}
        <LimitedBackdrop open={phase == Phase.Phase4}>
          <Grid container direction="column" alignItems="center">
            <Typography component="h2" color="textPrimary">
              Candy Machine Opens
            </Typography>
            <PhaseCountdown
              date={toDate(candyMachine?.state.goLiveDate)}
              status="Open"
            />
          </Grid>
        </LimitedBackdrop>
        <Paper
          style={{ padding: 24, backgroundColor: '#151A1F', borderRadius: 6 }}
        >
          <Grid container justifyContent="center" direction="column">
            {phase == Phase.Phase0 && (
              <Header
                phaseName={'Phase 0'}
                desc={'Anticipation Phase'}
                date={fairLaunch?.state.data.phaseOneStart}
              />
            )}
            {phase == Phase.Phase1 && (
              <Header
                phaseName={'Phase 1'}
                desc={'Set price phase'}
                date={fairLaunch?.state.data.phaseOneEnd}
              />
            )}

            {phase == Phase.Phase2 && (
              <Header
                phaseName={'Phase 2'}
                desc={'Grace period'}
                date={fairLaunch?.state.data.phaseTwoEnd}
              />
            )}

            {phase == Phase.Lottery && (
              <Header
                phaseName={'Phase 3'}
                desc={'Lottery is running...'}
                date={fairLaunch?.state.data.phaseTwoEnd.add(
                  fairLaunch?.state.data.lotteryDuration,
                )}
              />
            )}

            {phase == Phase.Phase3 && (
              <Grid container justifyContent="center">
                <Grid xs={6} justifyContent="center" direction="column">
                  <Typography variant="h5">Phase 3</Typography>
                  <Typography variant="body1" color="textSecondary">
                    The Lottery is complete!
                  </Typography>
                </Grid>
                <Grid xs={6} container justifyContent="flex-end">
                  <PhaseCountdown
                    date={toDate(fairLaunch?.state.data.phaseTwoEnd)}
                    style={{ justifyContent: 'flex-end' }}
                    status="COMPLETE"
                  />
                </Grid>
              </Grid>
            )}

            {fairLaunch?.ticket && (
              <Grid
                container
                direction="column"
                justifyContent="center"
                alignItems="center"
                style={{ height: 200 }}
              >
                <Typography>Your bid</Typography>
                <Typography>
                  {formatNumber.format(
                    (fairLaunch?.ticket.data?.amount.toNumber() || 0) /
                      LAMPORTS_PER_SOL,
                  )}{' '}
                  SOL
                </Typography>
              </Grid>
            )}

            {[Phase.Phase1, Phase.Phase2].includes(phase) && (
              <>
                <Grid style={{ marginTop: 40, marginBottom: 20 }}>
                  <ValueSlider
                    min={min}
                    marks={marks}
                    max={max}
                    step={step}
                    value={contributed}
                    onChange={(ev, val) => setContributed(val as any)}
                    valueLabelDisplay="auto"
                    style={{
                      width: 'calc(100% - 40px)',
                      marginLeft: 20,
                      height: 30,
                    }}
                  />
                </Grid>
              </>
            )}

            {!wallet.connected ? (
              <ConnectButton>Connect Wallet</ConnectButton>
            ) : (
              <div>
                {[Phase.Phase1, Phase.Phase2].includes(phase) && (
                  <MintButton
                    onClick={onDeposit}
                    variant="contained"
                    disabled={!fairLaunch?.ticket && phase == Phase.Phase2}
                  >
                    {!fairLaunch?.ticket ? 'Place a bid' : 'Adjust your bid'}
                  </MintButton>
                )}

                {[Phase.Phase3].includes(phase) && (
                  <>
                    {isWinner(fairLaunch) && (
                      <MintButton
                        onClick={onPunchTicket}
                        variant="contained"
                        disabled={
                          fairLaunch?.ticket.data?.state.punched !== undefined
                        }
                      >
                        Punch Ticket
                      </MintButton>
                    )}

                    {!isWinner(fairLaunch) && (
                      <MintButton
                        onClick={onRefundTicket}
                        variant="contained"
                        disabled={
                          fairLaunch?.ticket.data?.state.withdrawn !== undefined
                        }
                      >
                        Refund Ticket
                      </MintButton>
                    )}
                  </>
                )}

                <MintContainer>
                  <MintButton
                    disabled={
                      candyMachine?.state.isSoldOut ||
                      isMinting ||
                      !candyMachine?.state.isActive
                    }
                    onClick={onMint}
                    variant="contained"
                  >
                    {candyMachine?.state.isSoldOut ? (
                      'SOLD OUT'
                    ) : candyMachine?.state.isActive ? (
                      isMinting ? (
                        <CircularProgress />
                      ) : (
                        'MINT'
                      )
                    ) : (
                      <PhaseCountdown
                        date={toDate(candyMachine?.state.goLiveDate)}
                        style={{ justifyContent: 'flex-end' }}
                      />
                    )}
                  </MintButton>
                </MintContainer>
              </div>
            )}

            <Grid container justifyContent="center" color="textSecondary">
              <Link
                component="button"
                variant="body2"
                color="textSecondary"
                align="center"
                onClick={() => {
                  setHowToOpen(true);
                }}
              >
                How this raffle works
              </Link>
            </Grid>
            <Dialog
              open={howToOpen}
              onClose={() => setHowToOpen(false)}
              PaperProps={{
                style: { backgroundColor: '#222933', borderRadius: 6 },
              }}
            >
              <MuiDialogTitle
                disableTypography
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Link
                  component="button"
                  variant="h6"
                  color="textSecondary"
                  onClick={() => {
                    setHowToOpen(true);
                  }}
                >
                  How it works
                </Link>
                <IconButton
                  aria-label="close"
                  className={dialogStyles.closeButton}
                  onClick={() => setHowToOpen(false)}
                >
                  <CloseIcon />
                </IconButton>
              </MuiDialogTitle>
              <MuiDialogContent>
                <Typography variant="h6">
                  Phase 1 - Set the fair price:
                </Typography>
                <Typography gutterBottom color="textSecondary">
                  Enter a bid in the range provided by the artist. The median of
                  all bids will be the "fair" price of the lottery ticket.
                </Typography>
                <Typography variant="h6">Phase 2 - Grace period:</Typography>
                <Typography gutterBottom color="textSecondary">
                  If your bid was at or above the fair price, you automatically
                  get a raffle ticket at that price. There's nothing else you
                  need to do. If your bid is below the median price, you can
                  still opt in at the fair price during this phase.
                </Typography>
                <Typography variant="h6">Phase 3 - The Lottery:</Typography>
                <Typography gutterBottom color="textSecondary">
                  Everyone who got a raffle ticket at the fair price is entered
                  to win an NFT. If you win an NFT, congrats. If you don’t, no
                  worries, your SOL will go right back into your wallet.
                </Typography>
              </MuiDialogContent>
            </Dialog>

            {/* {wallet.connected && (
              <p>
                Address: {shortenAddress(wallet.publicKey?.toBase58() || '')}
              </p>
            )}

            {wallet.connected && (
              <p>Balance: {(balance || 0).toLocaleString()} SOL</p>
            )} */}
          </Grid>
        </Paper>
      </Container>

      <Container maxWidth="sm" style={{ position: 'relative', marginTop: 10 }}>
        <div style={{ margin: 20 }}>
          <Grid container direction="row" wrap="nowrap">
            <Grid container md={4} direction="column">
              <Typography variant="body2" color="textSecondary">
                Bids
              </Typography>
              <Typography
                variant="h6"
                color="textPrimary"
                style={{ fontWeight: 'bold' }}
              >
                {fairLaunch?.state.numberTicketsSold.toNumber() || 0}
              </Typography>
            </Grid>
            <Grid container md={4} direction="column">
              <Typography variant="body2" color="textSecondary">
                Median bid
              </Typography>
              <Typography
                variant="h6"
                color="textPrimary"
                style={{ fontWeight: 'bold' }}
              >
                {formatNumber.format(median)} SOL
              </Typography>
            </Grid>
            <Grid container md={4} direction="column">
              <Typography variant="body2" color="textSecondary">
                Total raised
              </Typography>
              <Typography
                variant="h6"
                color="textPrimary"
                style={{ fontWeight: 'bold' }}
              >
                {formatNumber.format(
                  (fairLaunch?.treasury || 0) / LAMPORTS_PER_SOL,
                )}{' '}
                SOL
              </Typography>
            </Grid>
          </Grid>
        </div>
      </Container>
      <Snackbar
        open={alertState.open}
        autoHideDuration={6000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

interface AlertState {
  open: boolean;
  message: string;
  severity: 'success' | 'info' | 'warning' | 'error' | undefined;
}

const renderCounter = ({ days, hours, minutes, seconds, completed }: any) => {
  return (
    <CounterText>
      {hours} hours, {minutes} minutes, {seconds} seconds
    </CounterText>
  );
};

export default Home;