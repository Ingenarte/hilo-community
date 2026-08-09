import React from 'react';
import { InstallScene } from '../components';
import { URL } from '../theme';
import type { Step } from '../theme';

const STEPS: Step[] = [
  { title: 'Open Hilo in Chrome or Edge', sub: URL },
  { title: 'Click the install icon', sub: 'A monitor with a down arrow, right of the address bar' },
  { title: 'Click Install', sub: 'Launches as a standalone app' },
  { title: 'Now in your Dock', sub: 'Applications › Chrome Apps' },
];

export const MacosInstall: React.FC = () => (
  <InstallScene
    title="Install Hilo on macOS"
    device="laptop"
    affordance="install"
    steps={STEPS}
    highlightSteps={[1, 2]}
  />
);

export default MacosInstall;
