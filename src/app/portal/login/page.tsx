import { redirect } from 'next/navigation';

/**
 * Sign-in is one screen for everyone now. Old portal bookmarks land here;
 * send them to it.
 */
export default function PortalLoginPage() {
  redirect('/login');
}
