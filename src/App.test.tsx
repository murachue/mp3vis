import React from 'react';
import { render } from '@testing-library/react';
import App from './App';

test('renders instruction', () => {
  const { getByText } = render(<App />);
  const instrElement = getByText(/drag here/i);
  expect(instrElement).toBeInTheDocument();
});
