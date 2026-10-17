import React from 'react';
import { Composition } from 'remotion';
import { Plates, platesTL } from './Plates';
import { Case, caseTL } from './Case';
import { Progress, progressTL } from './Progress';
import { Drop, DROP_TOTAL } from './Drop';
import { FPS, K } from './common';

// вертикальные ролики для TikTok: 1080×1920, 60 кадров/с
export const Root: React.FC = () => (
  <>
    <Composition id="plates" component={Plates} durationInFrames={Math.round(platesTL.total * K)} fps={FPS} width={1080} height={1920} />
    <Composition id="case" component={Case} durationInFrames={Math.round(caseTL.total * K)} fps={FPS} width={1080} height={1920} />
    <Composition id="drop" component={Drop} durationInFrames={Math.round(DROP_TOTAL * K)} fps={FPS} width={1080} height={1920} />
    <Composition id="progress" component={Progress} durationInFrames={Math.round(progressTL.total * K)} fps={FPS} width={1080} height={1920} />
  </>
);
