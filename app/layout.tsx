import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GFacilERP',
  description: 'Gestão administrativa segura do FacilERP.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}<footer className="footer">Codado por 2E — <a href="https://instagram.com" rel="noreferrer" target="_blank">Instagram</a></footer></body></html>;
}
