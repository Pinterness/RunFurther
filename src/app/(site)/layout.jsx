import '../globals.css';
import '../../components/site/site.css';
import '../../components/site/runner.css';
import SiteFooter from '../../components/site/SiteFooter';
import SiteHeader from '../../components/site/SiteHeader';
import SupportChat from '../../components/site/SupportChat';

export const metadata = { title: 'RunFurther | Vietnam Running Platform', description: 'Run further with the events that move you.' };

export default function SiteLayout({ children }) {
  return <html lang="vi"><body><div className="app-shell"><SiteHeader /><main id="main-content" tabIndex={-1}>{children}</main><SiteFooter /><SupportChat /></div></body></html>;
}
