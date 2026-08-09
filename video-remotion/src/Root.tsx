import React from 'react';
import { Composition } from 'remotion';
import { IosInstall } from './compositions/IosInstall';
import { AndroidInstall } from './compositions/AndroidInstall';
import { WindowsInstall } from './compositions/WindowsInstall';
import { MacosInstall } from './compositions/MacosInstall';
import { Promo } from './compositions/Promo';
import { TOTAL_FRAMES } from './compositions/Promo/data';

// 12 s clips at 30 fps. Phones are portrait (1080x1920), desktops landscape
// (1920x1080). Composition `id`s must match the render scripts in package.json.
const FPS = 30;
const DURATION = 360;

export const RemotionRoot: React.FC = () => (
  <>
    {/* ~2:36 product promo: intro (HeyGen slot) + 10 feature chapters + OSS outro */}
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="IosInstall"
      component={IosInstall}
      durationInFrames={DURATION}
      fps={FPS}
      width={1080}
      height={1920}
    />
    <Composition
      id="AndroidInstall"
      component={AndroidInstall}
      durationInFrames={DURATION}
      fps={FPS}
      width={1080}
      height={1920}
    />
    <Composition
      id="WindowsInstall"
      component={WindowsInstall}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="MacosInstall"
      component={MacosInstall}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
