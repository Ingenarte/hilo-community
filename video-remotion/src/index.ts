// Remotion entry point. registerRoot MUST live alone in this module — sharing
// it with <Composition> definitions makes Fast Refresh call registerRoot twice.
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
