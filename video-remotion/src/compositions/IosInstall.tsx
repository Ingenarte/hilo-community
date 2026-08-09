import React from 'react';
import { InstallScene } from '../components';
import { URL } from '../theme';
import type { Step } from '../theme';

const STEPS: Step[] = [
  { title: 'Open Hilo in Safari', sub: URL },
  { title: 'Tap the Share button', sub: 'The square with an up arrow' },
  { title: 'Add to Home Screen', sub: 'Scroll down the share sheet' },
  { title: 'Keep "Open as Web App" on, then Add', sub: 'Hilo lands on your Home Screen' },
];

export const IosInstall: React.FC = () => (
  <InstallScene
    title="Install Hilo on iPhone"
    device="phone"
    affordance="share"
    steps={STEPS}
    highlightSteps={[1, 2]}
  />
);

export default IosInstall;
