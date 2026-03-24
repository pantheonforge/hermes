import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import 'xterm/css/xterm.css';
import App from './App';

createRoot(document.getElementById('root')).render(<App />);
