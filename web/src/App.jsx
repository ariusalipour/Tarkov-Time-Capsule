import React from 'react';
import SpawnChanceGraph from './SpawnChanceGraph';
import './App.css';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

function App() {
  return (
      <Theme theme={neutralTheme} mode="dark">
        <SpawnChanceGraph />
      </Theme>
  );
}

export default App;
