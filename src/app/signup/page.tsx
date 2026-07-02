import { AuthPage } from '@/ui/components/auth-page';

type SignUpPageProps = {
  searchParams?: {
    callbackUrl?: string;
  };
};

export default function SignUpPage({ searchParams }: SignUpPageProps) {
  return <AuthPage mode="signup" callbackUrl={searchParams?.callbackUrl} />;
}
