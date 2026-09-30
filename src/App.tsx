import { useSession } from "./data/useSession";
import Chat from "./ui/Chat";
import Login from "./ui/Login";

export default function App() {
  const { loading, session, isPro, refreshPlan, signOut } = useSession();

  if (loading) return <div className="h-full" />;
  if (!session) return <Login />;
  return (
    <Chat
      key={session.user.id}
      email={session.user.email ?? ""}
      isPro={isPro}
      onRefreshPlan={refreshPlan}
      onSignOut={() => void signOut()}
    />
  );
}
