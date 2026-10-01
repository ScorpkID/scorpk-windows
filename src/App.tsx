import { useSession } from "./data/useSession";
import Home from "./ui/Home";
import Login from "./ui/Login";

export default function App() {
  const { loading, session, isPro, refreshPlan, signOut } = useSession();

  if (loading) return <div className="h-full" />;
  if (!session) return <Login />;
  return (
    <Home
      key={session.user.id}
      userId={session.user.id}
      email={session.user.email ?? ""}
      isPro={isPro}
      onRefreshPlan={refreshPlan}
      onSignOut={() => void signOut()}
    />
  );
}
