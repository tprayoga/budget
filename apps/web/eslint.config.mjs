import reactHooks from 'eslint-plugin-react-hooks';
import base from '../../eslint.config.mjs';

export default [
  ...base,
  { plugins: { 'react-hooks': reactHooks }, rules: { ...reactHooks.configs.recommended.rules } },
];
