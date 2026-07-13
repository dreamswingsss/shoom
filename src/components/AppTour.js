import { useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CopilotProvider, useCopilot } from 'react-native-copilot';
import TourTooltip from './TourTooltip';

const FIRST_LAUNCH_KEY = '@first_launch';
// Time to let the Closet tab mount/lay out before copilot measures its
// target — react-native-copilot can't point at a view that hasn't rendered
// yet, so this is a deliberate (if slightly fragile) buffer.
const START_DELAY_MS = 700;

export default function AppTour({ children, navigationRef }) {
  return (
    <CopilotProvider
      overlay="view"
      animated
      backdropColor="rgba(0, 0, 0, 0.82)"
      tooltipComponent={TourTooltip}
      stepNumberComponent={() => null}
    >
      <TourController navigationRef={navigationRef} />
      {children}
    </CopilotProvider>
  );
}

function TourController({ navigationRef }) {
  const { start, copilotEvents } = useCopilot();

  useEffect(() => {
    let cancelled = false;

    async function maybeStartTour() {
      // react-native-web renders RN's <Modal> via a portal to document.body,
      // full-viewport — it ignores our centered, fixed-width web "phone
      // frame" shell entirely. That's what was dimming/misaligning the tab
      // bar. Disabled on web until that's resolved; unaffected on native.
      if (Platform.OS === 'web') return;

      const seen = await AsyncStorage.getItem(FIRST_LAUNCH_KEY);
      if (seen || cancelled) return;

      // Step 1 lives on the Closet screen. The navigator defaults to the
      // Profile tab, so force Closet active first or the step's target
      // never mounts and copilot has nothing to measure. `navigationRef` is
      // attached to the root Stack (Main/ItemDetail) added for
      // ItemDetailScreen, so reaching a tab now needs the nested { screen }
      // form rather than a flat `navigate('Closet')`.
      if (navigationRef?.current?.isReady()) {
        navigationRef.current.navigate('Main', { screen: 'Closet' });
      }

      setTimeout(() => {
        if (!cancelled) start();
      }, START_DELAY_MS);
    }

    maybeStartTour();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleStop() {
      AsyncStorage.setItem(FIRST_LAUNCH_KEY, 'true');
    }
    copilotEvents.on('stop', handleStop);
    return () => copilotEvents.off('stop', handleStop);
  }, [copilotEvents]);

  return null;
}
