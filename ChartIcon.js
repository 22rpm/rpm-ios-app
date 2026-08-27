// ChartIcon.js — a rising line-graph / trend icon for the Readings tab, drawn with
// react-native-svg (already a dependency). Vector, so crisp at any size and tinted
// by `color` — no PNG, no new dependency.

import React from 'react';
import Svg, { Polyline } from 'react-native-svg';

export default function ChartIcon({ size = 26, color = '#000', strokeWidth = 2 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* rising line */}
      <Polyline
        points="3,16 9,11 13,14 20,5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* arrow head pointing up-right at the end of the trend */}
      <Polyline
        points="15,5 20,5 20,10"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* baseline axis, subtle */}
      <Polyline
        points="3,20 21,20"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity={0.35}
      />
    </Svg>
  );
}
