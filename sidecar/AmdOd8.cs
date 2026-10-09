// AMD Overdrive8 fan curve (RX 5000/6000/7000+). LibreHardwareMonitor only writes through the
// legacy Overdrive5 API, which these cards ignore, so the curve is written to the driver directly.
using System;
using System.Runtime.InteropServices;

static class AmdOd8 {
    const int OD8_COUNT = 77;
    const int FAN_ZERORPM = 15, CURVE_T1 = 19; // T1,S1,T2,S2...T5,S5 = 19..28
    const int CAP_FAN_CURVE = 1 << 13;

    [StructLayout(LayoutKind.Sequential)] struct InitSetting { public int featureID, minValue, maxValue, defaultValue; }
    [StructLayout(LayoutKind.Sequential)] struct SingleSet { public int value, requested, reset; }
    [StructLayout(LayoutKind.Sequential)] struct SetSetting {
        public int count;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = OD8_COUNT)] public SingleSet[] table;
    }
    [StructLayout(LayoutKind.Sequential)] struct CurrentSetting {
        public int count;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = OD8_COUNT)] public int[] table;
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate IntPtr MallocCb(int size);
    const string Dll = "atiadlxx.dll";
    [DllImport(Dll)] static extern int ADL2_Main_Control_Create(MallocCb cb, int connected, out IntPtr ctx);
    [DllImport(Dll)] static extern int ADL2_Adapter_NumberOfAdapters_Get(IntPtr ctx, out int n);
    [DllImport(Dll)] static extern int ADL2_Adapter_Active_Get(IntPtr ctx, int idx, out int active);
    [DllImport(Dll)] static extern int ADL2_Overdrive_Caps(IntPtr ctx, int idx, out int supported, out int enabled, out int version);
    [DllImport(Dll)] static extern int ADL2_Overdrive8_Init_SettingX2_Get(IntPtr ctx, int idx, out int caps, out int count, out IntPtr list);
    [StructLayout(LayoutKind.Sequential)] struct InitAll {
        public int count, caps;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = OD8_COUNT)] public InitSetting[] table;
    }
    [DllImport(Dll)] static extern int ADL2_Overdrive8_Init_Setting_Get(IntPtr ctx, int idx, ref InitAll s);
    [DllImport(Dll)] static extern int ADL2_Overdrive8_Current_Setting_Get(IntPtr ctx, int idx, ref CurrentSetting s);
    [DllImport(Dll)] static extern int ADL2_Overdrive8_Current_SettingX2_Get(IntPtr ctx, int idx, out int count, out IntPtr list);
    [DllImport(Dll)] static extern int ADL2_Overdrive8_Setting_Set(IntPtr ctx, int idx, ref SetSetting set, ref CurrentSetting current);

    static readonly MallocCb malloc = size => Marshal.AllocHGlobal(size);
    static IntPtr ctx;
    static int adapter = -1;
    static InitSetting[] init;
    public static bool Applied;
    static int[] before; // the user's own curve/zero-RPM values, restored on Reset
    static int[] written = new int[10];

    /// True when something else (usually Radeon Software's tuning profile) rewrote our curve.
    public static bool Overridden() {
        if (adapter < 0 || !Applied) return false;
        SetSetting s = Current();
        for (int k = 0; k < 10; k++) if (s.table[CURVE_T1 + k].value != written[k]) return true;
        return false;
    }

    public static string CurveNow() {
        if (adapter < 0) return "";
        SetSetting s = Current();
        string r = "zr=" + s.table[FAN_ZERORPM].value + " curve=";
        for (int k = 0; k < 10; k++) r += s.table[CURVE_T1 + k].value + (k % 2 == 1 ? " " : "/");
        return r;
    }

    public static bool Open() {
        try {
            int rc = ADL2_Main_Control_Create(malloc, 1, out ctx);
            if (rc != 0) { Console.Error.WriteLine("adl create " + rc); return false; }
            int n; ADL2_Adapter_NumberOfAdapters_Get(ctx, out n);
            for (int i = 0; i < n && adapter < 0; i++) {
                int active, sup, en, ver;
                if (ADL2_Adapter_Active_Get(ctx, i, out active) != 0 || active == 0) continue;
                int rcap = ADL2_Overdrive_Caps(ctx, i, out sup, out en, out ver);
                Console.Error.WriteLine("adapter " + i + " caps rc=" + rcap + " sup=" + sup + " en=" + en + " ver=" + ver);
                if (rcap != 0 || ver < 8) continue;
                int caps, count; IntPtr list;
                int ri = ADL2_Overdrive8_Init_SettingX2_Get(ctx, i, out caps, out count, out list);
                Console.Error.WriteLine("od8 init rc=" + ri + " caps=0x" + caps.ToString("x") + " count=" + count);
                if (ri != 0) {
                    InitAll all = new InitAll { count = OD8_COUNT, table = new InitSetting[OD8_COUNT] };
                    int r1 = ADL2_Overdrive8_Init_Setting_Get(ctx, i, ref all);
                    Console.Error.WriteLine("od8 init (v1) rc=" + r1 + " caps=0x" + all.caps.ToString("x"));
                    if (r1 != 0 || (all.caps & CAP_FAN_CURVE) == 0) continue;
                    init = all.table; adapter = i; continue;
                }
                if ((caps & CAP_FAN_CURVE) == 0) { Marshal.FreeHGlobal(list); continue; }
                init = new InitSetting[OD8_COUNT];
                int size = Marshal.SizeOf(typeof(InitSetting));
                for (int k = 0; k < Math.Min(count, OD8_COUNT); k++)
                    init[k] = (InitSetting)Marshal.PtrToStructure(new IntPtr(list.ToInt64() + k * size), typeof(InitSetting));
                Marshal.FreeHGlobal(list);
                adapter = i;
            }
        } catch (Exception e) { Console.Error.WriteLine("adl: " + e.GetType().Name + " " + e.Message); return false; }
        if (adapter >= 0) Console.Error.WriteLine("amd od8 fan curve: adapter " + adapter + " temp " + init[CURVE_T1].minValue + "-" + init[CURVE_T1].maxValue + " speed " + init[CURVE_T1 + 1].minValue + "-" + init[CURVE_T1 + 1].maxValue);
        return adapter >= 0;
    }

    static SetSetting Current() {
        SetSetting s = new SetSetting { count = OD8_COUNT, table = new SingleSet[OD8_COUNT] };
        CurrentSetting cur = new CurrentSetting { count = OD8_COUNT, table = new int[OD8_COUNT] };
        int r = ADL2_Overdrive8_Current_Setting_Get(ctx, adapter, ref cur);
        if (r != 0) Console.Error.WriteLine("amd od8 current failed: " + r);
        for (int k = 0; k < OD8_COUNT; k++) s.table[k].value = cur.table[k];
        return s;
    }

    static bool Write(SetSetting s) {
        CurrentSetting cur = new CurrentSetting { count = OD8_COUNT, table = new int[OD8_COUNT] };
        int r = ADL2_Overdrive8_Setting_Set(ctx, adapter, ref s, ref cur);
        if (r != 0) Console.Error.WriteLine("amd od8 set failed: " + r);
        return r == 0;
    }

    static int Clamp(int v, InitSetting r) { return Math.Max(r.minValue, Math.Min(r.maxValue, v)); }

    /// pts = t1,s1,...,t5,s5 (°C, %). Zero-RPM is switched off so the curve holds at low temperatures.
    public static bool SetCurve(int[] pts) {
        if (adapter < 0 || pts.Length != 10) return false;
        SetSetting s = Current();
        if (before == null) { before = new int[OD8_COUNT]; for (int k = 0; k < OD8_COUNT; k++) before[k] = s.table[k].value; }
        int lastT = int.MinValue, lastS = 0;
        for (int k = 0; k < 10; k++) {
            int id = CURVE_T1 + k;
            int v = Clamp(pts[k], init[id]);
            if (k % 2 == 0) { v = Math.Max(v, lastT + 1); lastT = v; } else { v = Math.Max(v, lastS); lastS = v; }
            s.table[id].value = v; s.table[id].requested = 1; written[k] = v;
        }
        s.table[FAN_ZERORPM].value = 0; s.table[FAN_ZERORPM].requested = 1;
        Applied = Write(s);
        return Applied;
    }

    public static void Reset() {
        if (adapter < 0 || !Applied || before == null) return;
        SetSetting s = Current();
        for (int id = CURVE_T1; id < CURVE_T1 + 10; id++) { s.table[id].value = before[id]; s.table[id].requested = 1; }
        s.table[FAN_ZERORPM].value = before[FAN_ZERORPM]; s.table[FAN_ZERORPM].requested = 1;
        Write(s);
        Applied = false;
    }
}
