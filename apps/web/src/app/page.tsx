import { redirect } from "next/navigation";
import { LoginCard } from "@/components/LoginCard";
import { loginErrorMessage } from "@/lib/login-error";
import { findBusiness } from "@/lib/server/business";
import { currentUserId, homePath } from "@/lib/server/session";
import { signInAsDemo } from "./actions";

export default async function StartPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const userId = await currentUserId();
  if (userId !== null) {
    redirect(homePath(await findBusiness(userId)));
  }
  const { error } = await searchParams;
  return <LoginCard errorText={loginErrorMessage(typeof error === "string" ? error : undefined)} signInAsDemo={signInAsDemo} />;
}
