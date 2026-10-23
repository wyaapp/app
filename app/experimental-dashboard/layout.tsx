import type { ReactNode } from 'react';
import './desktop.css';

export const metadata = {
  title: 'Experimental desktop',
  robots: { index: false, follow: false },
};

export default function ExperimentalLayout({ children }: { children: ReactNode }) {
  return children;
}
