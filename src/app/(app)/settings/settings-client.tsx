"use client";

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { api, type ApiKeyRecord, type ModelRow } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, KeyRound, Plus, Trash2, XCircle, Brain } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MemoryDashboard } from "@/components/memory/MemoryDashboard";

export function SettingsClient() {
  const [profile, setProfile] = useState<{ name: string; email: string; role: string } | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [providers, setProviders] = useState<{ id: string; label: string; configured: boolean }[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [newKey, setNewKey] = useState<{ provider: string; name: string; apiKey: string }>({ provider: "openai", name: "", apiKey: "" });
  const [savingKey, setSavingKey] = useState(false);

  const load = useCallback(async () => {
    const all = await Promise.all([api.settings(), api.models(), api.apiKeys()]);
    setProfile(all[0].profile);
    setName(all[0].profile.name);
    setDefaultModel(typeof all[0].settings?.defaultModel === "string" ? all[0].settings.defaultModel : "");
    setModels(all[1].models);
    setProviders(all[1].providers);
    setKeys(all[2].keys);
  }, []);

  useEffect(() => {
    load().catch(() => {});
    fetch("/api/models").then((r) => r.json()).then((j) => setDemoMode(Boolean((j as { demoEnabled?: boolean }).demoEnabled))).catch(() => {});
  }, [load]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const patched = await api.patchSettings({ name, defaultModel: defaultModel || undefined });
      setProfile((p) => (p ? { ...p, name: patched.profile?.name ?? name } : p));
      setName(patched.profile?.name ?? name);
      toast.success("Profile updated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  };

  const addKey = async () => {
    if (!newKey.apiKey.trim() || !newKey.name.trim()) return;
    setSavingKey(true);
    try {
      const res = await api.createApiKey({ provider: newKey.provider, name: newKey.name, apiKey: newKey.apiKey.trim() });
      toast.success(`${res.provider} key saved`);
      setNewKey({ provider: newKey.provider, name: "", apiKey: "" });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const removeKey = async (id: string) => {
    try {
      await api.deleteApiKey(id);
      toast.success("Key removed");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Profile, AI providers and workspace configuration.</p>
        </div>

        {demoMode && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>Demo mode is active</AlertTitle>
            <AlertDescription>
              AI Nexus is running with its built-in demo provider. Only demo responses will be produced. Add an OpenAI/Anthropic/Google key below or a local model to unlock real generation.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="models">
          <TabsList>
            <TabsTrigger value="models">AI Models</TabsTrigger>
            <TabsTrigger value="keys">API Keys</TabsTrigger>
            <TabsTrigger value="memory">
              <Brain className="size-4 mr-2" />
              Memory
            </TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Provider status</CardTitle>
                <CardDescription>Models are available when the matching provider has a key configured (server or yours).</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2">
                  {providers.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <span className="text-sm font-medium">{p.label}</span>
                      {p.configured ? (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle2 className="size-3" /> Configured
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <XCircle className="size-3" /> Not configured
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Available models</CardTitle>
                <CardDescription>Keyed from the model catalog. Availability reflects provider keys.</CardDescription>
              </CardHeader>
              <CardContent>
                {models.length === 0 ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <div className="grid gap-2">
                    {models.map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{m.mock ? `${m.label} (demo)` : m.label}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.provider} · {m.contextWindow.toLocaleString()} ctx{m.supportsTools ? " · tools" : ""}
                            {m.available ? ` · key: ${m.keySource ?? "server"}` : ` · ${m.reason ?? "not configured"}`}
                          </p>
                        </div>
                        {m.available || m.mock ? (
                          <Badge variant="secondary">available</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            unavailable
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="keys" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Manage your keys</CardTitle>
                <CardDescription>
                  Keys are encrypted at rest with your server&apos;s encryption key and used only for chat/model requests you make.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]">
                  <Select value={newKey.provider} onValueChange={(v) => v && setNewKey((k) => ({ ...k, provider: v }))}>
                    <SelectTrigger aria-label="Provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="gemini">Google Gemini</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input placeholder="Name (e.g. dev)" value={newKey.name} onChange={(e) => setNewKey((k) => ({ ...k, name: e.target.value }))} />
                  <Input placeholder="sk-… / api key" type="password" value={newKey.apiKey} onChange={(e) => setNewKey((k) => ({ ...k, apiKey: e.target.value }))} />
                  <Button onClick={addKey} disabled={savingKey}>
                    <Plus className="size-4" /> Add
                  </Button>
                </div>

                <Separator />

                {keys.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No personal keys yet. Keys configured on the server also unlock models.</p>
                ) : (
                  <div className="grid gap-2">
                    {keys.map((k) => (
                      <div key={k.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div>
                          <p className="flex items-center gap-2 text-sm font-medium">
                            <KeyRound className="size-3.5" />
                            {k.provider} · {k.name}
                          </p>
                          <p className="text-xs text-muted-foreground">…{k.last4}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeKey(k.id)} aria-label="Remove key">
                          <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="memory" className="space-y-4 pt-4">
            <MemoryDashboard />
          </TabsContent>

          <TabsContent value="appearance" className="space-y-4 pt-4">
            <AppearanceTab />
          </TabsContent>

          <TabsContent value="profile" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Profile</CardTitle>
                <CardDescription>Your name is shown in the sidebar and to other workspace members if shared.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Default model</Label>
                  <Select value={defaultModel || ""} onValueChange={(v) => setDefaultModel(v ?? "")}>
                    <SelectTrigger aria-label="Default model">
                      <SelectValue placeholder="Use recommended model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Use recommended model</SelectItem>
                      {models.filter((m) => m.available || m.mock).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.mock ? `${m.label} (demo)` : m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Email</Label>
                  <Input value={profile?.email ?? ""} disabled />
                </div>
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Input value={profile?.role ?? ""} disabled />
                </div>
                <Button onClick={saveProfile} disabled={savingProfile}>
                  {savingProfile ? "Saving…" : "Save changes"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}

function AppearanceTab() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Theme</CardTitle>
        <CardDescription>Applied instantly, persisted in your browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Label htmlFor="theme">Theme</Label>
          <Select value={resolvedTheme ?? "system"} onValueChange={(v) => v && setTheme(v)}>
            <SelectTrigger className="w-40" aria-label="Theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <Label>Reduce motion hints</Label>
            <p className="text-xs text-muted-foreground">Streaming caret and transitions</p>
          </div>
          <Switch defaultChecked aria-label="Motion" />
        </div>
      </CardContent>
    </Card>
  );
}