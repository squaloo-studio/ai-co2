// Starts the page on the real store.

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/data.css';
import './styles/result.css';
import './styles/chapters.css';

import { createStore } from './app/store';
import { mountPage } from './ui';

// Set when the page is bundled (vite.config.ts): true in the development server and in a build made
// with `--mode demo`, false in every other build.
declare const __AI_CO2_DEMO__: boolean;

// The stand-in store with its made-up numbers is for looking at the page's states. In the build that
// is published the condition below is the word `false` by the time the code is bundled, so the whole
// branch, the file it loads and the switch in the address are left out. src/build.test.ts holds the
// build to that.
if (__AI_CO2_DEMO__) {
  const scenario = new URLSearchParams(location.search).get('demo');
  if (scenario === null) mountPage(createStore());
  else {
    void import('./app/demo').then((demo) => {
      demo.showExampleLabels();
      mountPage(demo.createDemoStore(demo.scenarioFrom(scenario)));
    });
  }
} else {
  mountPage(createStore());
}
