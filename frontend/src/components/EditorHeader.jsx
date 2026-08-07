import { ClosedCaptioning, Crown, SignOut, UserCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export const EditorHeader = ({ user, usage, onPricing, onLogout }) => {
  const logout = async () => {
    await api.post("/auth/logout");
    onLogout();
  };
  const credits = (usage?.free_remaining || 0) + (usage?.oneoff_credits || 0) + (usage?.basic_credits || 0);
  return (
    <header className="editor-header" data-testid="editor-header">
      <div className="brand-lockup" data-testid="editor-brand"><span className="brand-mark"><ClosedCaptioning size={22} weight="fill" /></span> CAPTAIN TITLE</div>
      <div className="header-actions">
        <button className="usage-meter" onClick={onPricing} data-testid="usage-meter-button">
          <span data-testid="usage-credit-count">{!usage ? "Checking access…" : usage.unlimited_testing ? "Unlimited tests" : `${credits} credits`}</span>
          <i style={{ width: !usage ? "18%" : usage.unlimited_testing ? "100%" : `${Math.min(100, credits * 10)}%` }} />
        </button>
        <Button variant="outline" onClick={onPricing} data-testid="view-plans-button"><Crown size={17} /> Plans</Button>
        <div className="user-chip" data-testid="signed-in-user">
          {user.picture ? <img src={user.picture} alt="" data-testid="user-avatar-image" /> : <UserCircle size={24} />}
          <span data-testid="signed-in-user-name">{user.name}</span>
        </div>
        <Button size="icon" variant="ghost" onClick={logout} title="Sign out" data-testid="logout-button"><SignOut size={19} /></Button>
      </div>
    </header>
  );
};