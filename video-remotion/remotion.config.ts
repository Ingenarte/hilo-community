import { Config } from '@remotion/cli/config';

// H.264 .mp4 output, reasonably compressed so the four clips committed under
// ../static/help stay small enough to ship in the app bundle.
Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setCrf(23);
Config.setOverwriteOutput(true);
