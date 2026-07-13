import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, MapPin, Loader2, X } from "lucide-react";
import { useLocation } from "@/lib/location-context";
import { searchPlaces as searchLocations } from "@/lib/geocoding";
import { toast } from "sonner";

interface Suggestion {
  id: string;
  label: string;
  point: { lat: number; lng: number };
}

export function ManualLocationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { setLocation, setAddress } = useLocation();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runSearch = async (val: string) => {
    if (val.length < 3) {
      setSuggestions([]);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    try {
      const results = await searchLocations(val, undefined, abortControllerRef.current.signal);
      setSuggestions(results ?? []);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Search failed", err);
      }
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) runSearch(query);
      else setSuggestions([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (s: Suggestion) => {
    setLocation(s.point);
    setAddress(s.label);
    onOpenChange(false);
    toast.success("Location set to " + s.label.split(",")[0]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden border-white/10 bg-background/95 backdrop-blur-2xl">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Set your location
          </DialogTitle>
          <DialogDescription>
            Enter your town name and pincode to see what's available in your area.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="e.g. Indiranagar, 560038"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 h-12 bg-white/5 border-white/10 focus-visible:ring-primary/30"
              autoFocus
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSelect(s)}
                className="w-full text-left p-3 rounded-xl hover:bg-primary/10 transition-colors flex items-start gap-3 group border border-transparent hover:border-primary/20"
              >
                <MapPin className="h-4 w-4 mt-1 text-muted-foreground group-hover:text-primary shrink-0" />
                <span className="text-sm font-medium leading-tight">{s.label}</span>
              </button>
            ))}
            {query.length >= 3 && !loading && suggestions.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No locations found for "{query}"</p>
                <p className="text-xs mt-1">Try a different town name or pincode.</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
