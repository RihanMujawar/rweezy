import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { fieldErrors, phoneSchema, registerSchema } from "@/lib/validation";
import { PhoneOtpVerification } from "@/components/phone-otp-verification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ManualLocationDialog } from "@/components/manual-location-dialog";
import { useLocation } from "@/lib/location-context";
import { LocateFixed, MapPin } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/register-partner")({
  component: PartnerRegisterPage,
});

const roleOptions = [
  { value: "rider", label: "Rider for rides/packages" },
  { value: "delivery_boy", label: "Food/grocery delivery partner" },
  { value: "hotel_manager", label: "Restaurant manager" },
  { value: "grocery_manager", label: "Grocery manager" },
] as const;

function PartnerRegisterPage() {
  const navigate = useNavigate();
  const { setAuthenticatedUser } = useAuth();
  const {
    location: businessLocation,
    address: detectedAddress,
    detectLocation,
    loading: locationLoading,
  } = useLocation();
  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneSuffix, setPhoneSuffix] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestedRole, setRequestedRole] =
    useState<(typeof roleOptions)[number]["value"]>("rider");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [townName, setTownName] = useState("");
  const [pincode, setPincode] = useState("");
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [roleMessage, setRoleMessage] = useState("");
  const [phoneVerificationToken, setPhoneVerificationToken] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const fullPhone = `${countryCode}${phoneSuffix.replace(/\D/g, "")}`;
  const isStoreRole = requestedRole === "hotel_manager" || requestedRole === "grocery_manager";

  useEffect(() => {
    setPhoneVerificationToken("");
  }, [fullPhone]);

  useEffect(() => {
    if (detectedAddress) setBusinessAddress(detectedAddress);
  }, [detectedAddress]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse({
      fullName,
      phone: fullPhone,
      password,
      confirmPassword,
      requestedRole,
      businessName,
      businessAddress,
      townName,
      pincode,
      businessLocation,
      roleMessage,
    });

    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check the form");
      return;
    }

    if (!phoneVerificationToken) {
      toast.error("Verify your phone number with the OTP code before signing up");
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      const {
        fullName: parsedFullName,
        phone: parsedPhone,
        requestedRole: parsedRequestedRole,
        businessName: parsedBusinessName,
        businessAddress: parsedBusinessAddress,
        townName: parsedTownName,
        pincode: parsedPincode,
        businessLocation: parsedBusinessLocation,
        roleMessage: parsedRoleMessage,
      } = parsed.data;

      const result = await api.auth.register({
        full_name: parsedFullName,
        phone: parsedPhone,
        password,
        phone_verification_token: phoneVerificationToken,
        requested_role: parsedRequestedRole,
        business_name: parsedBusinessName,
        business_address: parsedBusinessAddress,
        business_lat: parsedBusinessLocation?.lat,
        business_lng: parsedBusinessLocation?.lng,
        town_name: parsedTownName,
        pincode: parsedPincode,
        role_message: parsedRoleMessage,
      });

      if (result.authenticated) {
        setAuthenticatedUser(result);
        toast.warning(
          result.roleRequestWarning ??
            "Account created! Your role request is pending admin approval.",
        );
        navigate({ to: "/app" });
      } else {
        toast.success("Account created! You can now sign in.");
        navigate({ to: "/login" });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-4 py-12 animate-fade-in-up">
      <div className="w-full max-w-lg rounded-2xl border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
        <Link
          to="/"
          className="text-2xl font-extrabold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent hover:opacity-90 transition-opacity"
        >
          Rweezy
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Create a partner account</h1>
        <p className="text-sm text-muted-foreground">
          Verify your phone with WhatsApp OTP, then create your partner account.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone number</Label>
            <div className="flex gap-2">
              <Input
                aria-label="Country code"
                value={countryCode}
                onChange={(e) =>
                  setCountryCode(e.target.value.replace(/[^\d+]/g, "").slice(0, 5) || "+")
                }
                className="w-20"
              />
              <Input
                id="phone"
                type="tel"
                placeholder="9876543210"
                value={phoneSuffix}
                onChange={(e) => setPhoneSuffix(e.target.value.replace(/\D/g, "").slice(0, 15))}
                className="flex-1"
              />
            </div>
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>

          <PhoneOtpVerification
            phone={fullPhone}
            purpose="register"
            onVerified={setPhoneVerificationToken}
            disabled={!phoneSchema.safeParse(fullPhone).success}
          />

          <div className="space-y-2">
            <Label htmlFor="requestedRole">Choose role</Label>
            <select
              id="requestedRole"
              value={requestedRole}
              onChange={(e) => setRequestedRole(e.target.value as typeof requestedRole)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              These roles create a pending admin approval request.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-2">
              <Label htmlFor="businessName">
                {isStoreRole ? "Restaurant or store name" : "Business or vehicle details"}
              </Label>
              <Input
                id="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Restaurant/store name, vehicle number, or service area"
              />
              {errors.businessName && (
                <p className="text-xs text-destructive">{errors.businessName}</p>
              )}
            </div>
            {isStoreRole && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="businessAddress">Complete business address</Label>
                  <Textarea
                    id="businessAddress"
                    value={businessAddress}
                    onChange={(e) => setBusinessAddress(e.target.value)}
                    placeholder="Shop number, street, locality, town and pincode"
                  />
                  {errors.businessAddress && (
                    <p className="text-xs text-destructive">{errors.businessAddress}</p>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="townName">Town / city</Label>
                    <Input
                      id="townName"
                      value={townName}
                      onChange={(e) => setTownName(e.target.value)}
                      placeholder="Your town"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pincode">Pincode</Label>
                    <Input
                      id="pincode"
                      inputMode="numeric"
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 12))}
                      placeholder="110001"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Pin business location</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={locationLoading}
                      onClick={() =>
                        detectLocation().catch(() =>
                          toast.error("Location access failed. Search the address manually."),
                        )
                      }
                    >
                      <LocateFixed className="mr-2 h-4 w-4" />
                      {locationLoading ? "Detecting..." : "Use current location"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setLocationDialogOpen(true)}>
                      <MapPin className="mr-2 h-4 w-4" />
                      Search location
                    </Button>
                  </div>
                  {businessLocation ? (
                    <p className="text-xs text-emerald-600">
                      Location pinned ({businessLocation.lat.toFixed(5)},{" "}
                      {businessLocation.lng.toFixed(5)})
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Pin the exact entrance so nearby customers can discover your business.
                    </p>
                  )}
                  {errors.businessLocation && (
                    <p className="text-xs text-destructive">{errors.businessLocation}</p>
                  )}
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="roleMessage">Message for admin</Label>
              <Textarea
                id="roleMessage"
                value={roleMessage}
                onChange={(e) => setRoleMessage(e.target.value)}
                placeholder="Tell admins what access you need."
              />
              {errors.roleMessage && (
                <p className="text-xs text-destructive">{errors.roleMessage}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword}</p>
              )}
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading || !phoneVerificationToken}>
            {loading ? "Creating account..." : "Request access"}
          </Button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          <p>
            Need a normal customer account?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Use the customer signup page
            </Link>
          </p>
          <p>
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
      <ManualLocationDialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen} />
    </div>
  );
}
