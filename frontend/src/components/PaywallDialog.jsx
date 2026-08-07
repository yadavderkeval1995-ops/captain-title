import { Crown, Lightning, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api";

export const PaywallDialog = ({ open, onOpenChange, usage }) => {
  const checkout = async (packageId) => {
    try {
      const { data } = await api.post("/payments/checkout", { package_id: packageId, origin_url: window.location.origin });
      window.location.href = data.checkout_url;
    } catch (error) { toast.error(errorMessage(error)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pricing-dialog" data-testid="pricing-dialog">
        <DialogHeader><p className="eyebrow" data-testid="pricing-dialog-label"><Crown size={17} /> CREATOR ACCESS</p><DialogTitle data-testid="pricing-dialog-title">Keep your captions moving</DialogTitle></DialogHeader>
        <DialogDescription className="pricing-intro" data-testid="pricing-dialog-description">Your free 45-second video is included. Choose a pass or unlock a monthly creator batch.</DialogDescription>
        <div className="pricing-options">
          <div className="pricing-option" data-testid="single-video-plan-card"><Lightning size={23} /><h3>Single video</h3><strong>₹69</strong><p>1 video · up to 45 seconds</p><Button variant="outline" onClick={() => checkout("single_45")} data-testid="buy-single-video-button">Buy video pass</Button></div>
          <div className="pricing-option featured" data-testid="basic-plan-card"><Crown size={23} weight="fill" /><span className="popular">BEST FOR CREATORS</span><h3>Basic</h3><strong>₹399<small>/month</small></strong><p>10 videos · up to 60 seconds each</p><Button onClick={() => checkout("basic_monthly")} data-testid="buy-basic-plan-button">Choose Basic</Button></div>
        </div>
        <p className="pricing-note" data-testid="oneoff-purchase-limit-note">Single-video passes can be purchased up to 3 times; then Basic is required.</p>
        {usage?.subscription_active && <p className="active-plan" data-testid="active-plan-status">Basic plan active</p>}
        <button className="dialog-close-label" onClick={() => onOpenChange(false)} data-testid="pricing-dialog-close-button"><X size={16} /> Back to studio</button>
      </DialogContent>
    </Dialog>
  );
};