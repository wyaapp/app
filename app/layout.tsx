import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: {default:'wya.im — Where you at?',template:'%s · wya.im'},
  description:'One address for everywhere you are. Your links, your profile, managed through conversation.',
  icons:{icon:'/favicon.svg'},
};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
