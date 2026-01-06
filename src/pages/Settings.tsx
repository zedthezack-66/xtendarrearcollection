import { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Save, Loader2, Shield, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMasterCustomers, useTickets, usePayments, useBatches, useProfiles, useUpdateProfile, useUserRoles, useUpdateUserRole } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export default function Settings() {
  const { toast } = useToast();
  const { user, profile, userRole, isAdmin } = useAuth();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: tickets = [] } = useTickets();
  const { data: payments = [] } = usePayments();
  const { data: batches = [] } = useBatches();
  const { data: profiles = [] } = useProfiles();
  const { data: userRolesData = [] } = useUserRoles();
  const updateProfile = useUpdateProfile();
  const updateUserRoleMutation = useUpdateUserRole();

  const [fullName, setFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [isClearing, setIsClearing] = useState(false);

  // Build a map of userId -> role
  const userRoleMap = useMemo(() => {
    const map: Record<string, 'admin' | 'agent'> = {};
    for (const ur of userRolesData) {
      map[ur.user_id] = ur.role;
    }
    return map;
  }, [userRolesData]);

  // Get current user's profile from profiles list to include display_name
  const currentProfile = profiles.find(p => p.id === user?.id);

  useEffect(() => {
    if (currentProfile) {
      setFullName(currentProfile.full_name || '');
      setDisplayName((currentProfile as any).display_name || '');
      setPhone(currentProfile.phone || '');
    } else if (profile) {
      setFullName(profile.full_name || '');
      setPhone(profile.phone || '');
    }
  }, [currentProfile, profile]);

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    
    if (!displayName.trim()) {
      toast({ title: "Display name required", description: "Please enter a unique display name for CSV imports", variant: "destructive" });
      return;
    }

    // Check if display name is unique
    const existingWithName = profiles.find(p => 
      p.id !== user.id && 
      (p as any).display_name?.toLowerCase() === displayName.trim().toLowerCase()
    );
    
    if (existingWithName) {
      toast({ title: "Display name taken", description: "This display name is already used by another agent", variant: "destructive" });
      return;
    }
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          display_name: displayName.trim(),
          phone: phone.trim() || null,
        })
        .eq('id', user.id);

      if (error) throw error;
      
      toast({ title: "Profile updated successfully" });
    } catch (error: any) {
      if (error.code === '23505') {
        toast({ title: "Display name taken", description: "This display name is already used by another agent", variant: "destructive" });
      } else {
        toast({ title: "Error updating profile", description: error.message, variant: "destructive" });
      }
    }
  };

  const handleClearData = async () => {
    if (!isAdmin) {
      toast({ title: "Access Denied", description: "Only admins can clear all data", variant: "destructive" });
      return;
    }

    setIsClearing(true);
    try {
      const { data, error } = await supabase.rpc('clear_all_data');
      
      if (error) throw error;
      
      toast({ title: "Data Cleared", description: "All data has been successfully cleared" });
      
      // Refresh the page to reflect changes
      window.location.reload();
    } catch (error: any) {
      toast({ title: "Error clearing data", description: error.message, variant: "destructive" });
    } finally {
      setIsClearing(false);
    }
  };

  const handleRoleChange = (userId: string, newRole: 'admin' | 'agent') => {
    updateUserRoleMutation.mutate({ userId, newRole });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Manage your profile and view application statistics</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Profile</CardTitle>
          <CardDescription>Update your account information. Your display name is used for CSV imports.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input 
                id="fullName" 
                value={fullName} 
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name (for CSV imports) *</Label>
              <Input 
                id="displayName" 
                value={displayName} 
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., Ziba, Mary, John"
              />
              <p className="text-xs text-muted-foreground">
                This name will be used in the "Assigned Agent" column during CSV imports
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input 
                id="phone" 
                value={phone} 
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter your phone number"
              />
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="p-4 bg-muted rounded-lg flex-1">
              <p className="text-sm text-muted-foreground">Role</p>
              <Badge variant={userRole === 'admin' ? 'default' : 'secondary'} className="mt-1">
                {userRole === 'admin' ? 'Admin' : 'Agent'}
              </Badge>
              {userRole === 'admin' && (
                <p className="text-xs text-muted-foreground mt-1">You have full access to all data</p>
              )}
            </div>
          </div>
          <Button onClick={handleSaveProfile} disabled={updateProfile.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {updateProfile.isPending ? 'Saving...' : 'Save Profile'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            Team Members
          </CardTitle>
          <CardDescription>
            {isAdmin ? 'Manage user roles and team access' : 'Users with access to the system'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {profiles.map((p) => {
              const pRole = userRoleMap[p.id] || 'agent';
              const isSelf = p.id === user?.id;
              
              return (
                <div key={p.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{p.full_name}</p>
                      {(p as any).display_name && (
                        <Badge variant="outline" className="text-xs">
                          {(p as any).display_name}
                        </Badge>
                      )}
                      {isSelf && (
                        <Badge variant="secondary" className="text-xs">You</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{p.phone || 'No phone'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin ? (
                      <Select
                        value={pRole}
                        onValueChange={(value: 'admin' | 'agent') => handleRoleChange(p.id, value)}
                        disabled={isSelf || updateUserRoleMutation.isPending}
                      >
                        <SelectTrigger className="w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">
                            <div className="flex items-center gap-2">
                              <Shield className="h-3 w-3" />
                              Admin
                            </div>
                          </SelectItem>
                          <SelectItem value="agent">Agent</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={pRole === 'admin' ? 'default' : 'secondary'}>
                        {pRole === 'admin' ? 'Admin' : 'Agent'}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
            {profiles.length === 0 && (
              <p className="text-muted-foreground text-sm">No team members found</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Statistics</CardTitle>
          <CardDescription>Current data stored in the system</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-2xl font-bold">{batches.length}</p>
              <p className="text-sm text-muted-foreground">Batches</p>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-2xl font-bold">{masterCustomers.length}</p>
              <p className="text-sm text-muted-foreground">Customers</p>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-2xl font-bold">{tickets.length}</p>
              <p className="text-sm text-muted-foreground">Tickets</p>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-2xl font-bold">{payments.length}</p>
              <p className="text-sm text-muted-foreground">Payments</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription>Administrative actions (use with caution)</CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isClearing}>
                  {isClearing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    'Clear All Data'
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete all batches, customers, tickets, payments, and call logs from the database.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearData} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Yes, delete everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}