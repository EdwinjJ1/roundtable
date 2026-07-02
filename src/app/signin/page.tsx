import { AuthPage } from '@/ui/components/auth-page';

type SignInPageProps = {
  searchParams?: {
    callbackUrl?: string;
  };
};

export default function SignInPage({ searchParams }: SignInPageProps) {
  return <AuthPage mode="signin" callbackUrl={searchParams?.callbackUrl} />;
}
