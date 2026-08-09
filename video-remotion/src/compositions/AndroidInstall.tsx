import React from 'react';
import { InstallScene } from '../components';
import { URL } from '../theme';
import type { Step } from '../theme';

const STEPS: Step[] = [
  { title: 'Open Hilo in Chrome', sub: URL },
  { title: 'Tap the ⋮ menu', sub: 'Top-right of the Chrome toolbar' },
  { title: 'Choose "Install app"', sub: 'Or "Add to Home screen"' },
  { title: 'Tap Install', sub: 'Hilo joins your home screen' },
];

export const AndroidInstall: React.FC = () => (
  <InstallScene
    title="Install Hilo on Android"
    device="phone"
    affordance="dots"
    steps={STEPS}
    highlightSteps={[1, 2]}
  />
);

export default AndroidInstall;
