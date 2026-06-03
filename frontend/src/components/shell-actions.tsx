import { Link } from "@tanstack/react-router";
import { MessageCircle, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFoodCart } from "@/lib/food-cart";
import { useGroceryCart } from "@/lib/grocery-cart";
import { useOrderSummary } from "@/hooks/use-order-summary";

export function ShellActions() {
  const foodCart = useFoodCart();
  const groceryCart = useGroceryCart();
  const { activeOrders } = useOrderSummary();
  const foodCount = foodCart.items.reduce((sum, item) => sum + item.quantity, 0);
  const groceryCount = groceryCart.items.reduce((sum, item) => sum + item.quantity, 0);
  const itemCount = foodCount + groceryCount;
  const checkoutTo =
    foodCount > 0 ? "/app/food/checkout" : groceryCount > 0 ? "/app/grocery/checkout" : "/app/food";

  return (
    <div className="ml-auto flex items-center gap-2">
      {activeOrders.length > 0 && (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="relative h-11 w-11"
          aria-label="Open order chats"
        >
          <Link to="/app/orders">
            <MessageCircle className="h-5 w-5" />
            <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
              {activeOrders.length}
            </span>
          </Link>
        </Button>
      )}
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="relative h-11 w-11"
        aria-label="Open cart"
      >
        <Link to={checkoutTo}>
          <ShoppingCart className="h-5 w-5" />
          {itemCount > 0 && (
            <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {itemCount}
            </span>
          )}
        </Link>
      </Button>
    </div>
  );
}
