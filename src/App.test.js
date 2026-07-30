import React from 'react';
import ReactDOMServer from 'react-dom/server';
import App from './App';

test('renders learn react link', () => {
  const html = ReactDOMServer.renderToString(<App />);
  expect(html).toMatch(/Simple CRM Dashboard/i);
});
