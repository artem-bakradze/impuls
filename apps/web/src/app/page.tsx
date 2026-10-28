import { redirect } from "next/navigation";
import { LoginCard } from "@/components/LoginCard";
import { loginErrorMessage } from "@/lib/login-error";
import { findBusiness } from "@/lib/server/business";
import { webConfig } from "@/lib/server/config";
import { currentUserId, homePath } from "@/lib/server/session";
import { signInForTests, signInWithGoogle } from "./actions";

export default async function StartPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const userId = await currentUserId();
  if (userId !== null) {
    redirect(homePath(await findBusiness(userId)));
  }
  const { error } = await searchParams;
  return (
    <main className="page" style={{ maxWidth: 480, paddingTop: 48 }}>
      <LoginCard
        errorText={loginErrorMessage(typeof error === "string" ? error : undefined)}
        testLogin={webConfig().AUTH_TEST_LOGIN === "enabled"}
        signInWithGoogle={signInWithGoogle}
        signInForTests={signInForTests}
      />
    </main>
  );
}
