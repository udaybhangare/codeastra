package workerpool

import "testing"

func TestSpecValidate(t *testing.T) {
	for _, id := range []string{"", "../x", "a b", "-a", "a/b"} {
		if (Spec{TenantID: id}).validate() == nil {
			t.Errorf("tenant id %q should be rejected", id)
		}
	}
	if err := (Spec{TenantID: "acme-1", CPUs: 0.5, MemoryMB: 256}).validate(); err != nil {
		t.Fatal(err)
	}
	if (Spec{TenantID: "a", CPUs: -1}).validate() == nil {
		t.Error("negative cpus should be rejected")
	}
}

func TestCreateResources(t *testing.T) {
	r := createResources(Spec{TenantID: "a", CPUs: 0.5, MemoryMB: 256, PidsLimit: 100})
	if r.CpuQuota != 50_000 || r.CpuPeriod != cpuPeriod || r.NanoCpus != 0 || r.Memory != 256<<20 || r.MemorySwap != r.Memory || r.PidsLimit != 100 {
		t.Fatalf("limited: %+v", r)
	}
	if r := createResources(Spec{TenantID: "a"}); r != (resources{}) {
		t.Fatalf("unlimited must set nothing, got %+v", r)
	}
}

func TestUpdateResources(t *testing.T) {
	r := updateResources(Spec{TenantID: "a", CPUs: 0.25, MemoryMB: 64, PidsLimit: 50})
	if r.CpuQuota != 25_000 || r.Memory != 64<<20 || r.MemorySwap != r.Memory || r.PidsLimit != 50 || r.NanoCpus != 0 {
		t.Fatalf("limited: %+v", r)
	}
	u := updateResources(Spec{TenantID: "a"})
	if u.CpuQuota != -1 || u.CpuPeriod != cpuPeriod || u.Memory != unlimitedMem || u.MemorySwap != unlimitedMem || u.PidsLimit != -1 || u.NanoCpus != 0 {
		t.Fatalf("unlimited: %+v", u)
	}
}

func TestClassify(t *testing.T) {
	cases := []struct {
		oomEvt, state bool
		code          int
		want          EventKind
	}{
		{true, false, 137, EventOOMKilled},
		{false, true, 137, EventOOMKilled},
		{false, false, 137, EventExited}, // plain SIGKILL is not an OOM
		{false, false, 0, EventExited},
	}
	for _, c := range cases {
		if got := classify(c.oomEvt, c.state, c.code); got != c.want {
			t.Errorf("%+v: got %s", c, got)
		}
	}
}
