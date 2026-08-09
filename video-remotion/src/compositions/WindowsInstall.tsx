import React from 'react';
import { InstallScene } from '../components';
import { URL } from '../theme';
import type { Step } from '../theme';

const STEPS: Step[] = [
  { title: 'Open Hilo in Chrome or Edge', sub: URL },
  { title: 'Click the install icon', sub: 'A monitor with a down arrow, right of the address bar' },
  { title: 'Click Install', sub: 'Hilo opens in its own window' },
  { title: 'Find it in the Start menu', sub: 'Pin to the taskbar if you like' },
];

export const WindowsInstall: React.FC = () => (
  <InstallScene
    title="Install Hilo on Windows"
    device="laptop"
    affordance="install"
    steps={STEPS}
    highlightSteps={[1, 2]}
  />
);

export default WindowsInstall;
