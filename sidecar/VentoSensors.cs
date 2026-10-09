// Prints one JSON line per second with all temperature / fan / control sensors.
// Built with the .NET Framework csc (present on every Windows) + LibreHardwareMonitorLib.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading;
using LibreHardwareMonitor.Hardware;

class UpdateVisitor : IVisitor {
    public void VisitComputer(IComputer c) { c.Traverse(this); }
    public void VisitHardware(IHardware h) { h.Update(); foreach (IHardware s in h.SubHardware) s.Accept(this); }
    public void VisitSensor(ISensor s) { }
    public void VisitParameter(IParameter p) { }
}

class Program {
    static Dictionary<string, ISensor> controls = new Dictionary<string, ISensor>();
    static Computer pc;
    static HashSet<string> warned = new HashSet<string>();

    static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

    static void Collect(IHardware h, StringBuilder sb, ref bool first) {
        foreach (ISensor s in h.Sensors) {
            string t;
            switch (s.SensorType) {
                case SensorType.Temperature: t = "temp"; break;
                case SensorType.Fan: t = "fan"; break;
                case SensorType.Control: t = "ctrl"; break;
                default: continue;
            }
            if (t == "ctrl") {
                if (s.Control != null) controls[s.Identifier.ToString()] = s;
                else if (!warned.Contains(s.Identifier.ToString())) { warned.Add(s.Identifier.ToString()); Console.Error.WriteLine("read-only control: " + s.Identifier); }
            }
            if (!s.Value.HasValue) continue;
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"id\":\"").Append(Esc(s.Identifier.ToString())).Append("\",\"hw\":\"").Append(Esc(h.Name))
              .Append("\",\"name\":\"").Append(Esc(s.Name)).Append("\",\"type\":\"").Append(t)
              .Append("\",\"value\":").Append(s.Value.Value.ToString("0.#", CultureInfo.InvariantCulture)).Append('}');
        }
        foreach (IHardware sub in h.SubHardware) Collect(sub, sb, ref first);
    }

    // Commands on stdin: "set <sensorId> <percent>", "default <sensorId>", "defaultall",
    // "amdcurve t1 s1 ... t5 s5", "amddefault" (AMD Overdrive8 GPUs).
    // When stdin closes (parent gone) every fan goes back to its automatic mode.
    static void ResetAll() {
        lock (controls) {
            foreach (ISensor s in controls.Values) { try { s.Control.SetDefault(); } catch { } }
            try { AmdOd8.Reset(); } catch { }
        }
    }
    static void ReadCommands() {
        string line;
        while ((line = Console.In.ReadLine()) != null) {
            string[] p = line.Split(' ');
            try {
                lock (controls) {
                    if (p[0] == "defaultall") { foreach (ISensor s in controls.Values) s.Control.SetDefault(); AmdOd8.Reset(); }
                    else if (p[0] == "amddefault") AmdOd8.Reset();
                    else if (p[0] == "amdcurve" && p.Length == 11) {
                        int[] pts = new int[10];
                        for (int k = 0; k < 10; k++) pts[k] = int.Parse(p[k + 1], CultureInfo.InvariantCulture);
                        AmdOd8.SetCurve(pts);
                    }
                    else if (p.Length >= 2 && !controls.ContainsKey(p[1])) Console.Error.WriteLine("not controllable: " + p[1]);
                    else if (p.Length >= 2) {
                        ISensor s = controls[p[1]];
                        if (p[0] == "default") s.Control.SetDefault();
                        else if (p[0] == "set" && p.Length == 3) {
                            float v = float.Parse(p[2], CultureInfo.InvariantCulture);
                            if (v < s.Control.MinSoftwareValue) v = s.Control.MinSoftwareValue;
                            if (v > s.Control.MaxSoftwareValue) v = s.Control.MaxSoftwareValue;
                            s.Control.SetSoftware(v);
                        }
                    }
                }
            } catch (Exception e) { Console.Error.WriteLine("cmd failed: " + e.Message); }
        }
        ResetAll();
        pc.Close();
        Environment.Exit(0);
    }

    static int Main() {
        pc = new Computer();
        pc.IsCpuEnabled = true; pc.IsGpuEnabled = true; pc.IsMotherboardEnabled = true;
        pc.IsStorageEnabled = true; pc.IsControllerEnabled = true;
        try { pc.Open(); } catch (Exception e) { Console.Error.WriteLine("open failed: " + e.Message); return 2; }
        bool od8 = AmdOd8.Open();
        UpdateVisitor v = new UpdateVisitor();
        AppDomain.CurrentDomain.ProcessExit += delegate { ResetAll(); };
        Thread cmd = new Thread(ReadCommands); cmd.IsBackground = true; cmd.Start();
        while (true) {
            pc.Accept(v);
            StringBuilder sb = new StringBuilder("{\"sensors\":[");
            bool first = true;
            lock (controls) { foreach (IHardware h in pc.Hardware) Collect(h, sb, ref first); }
            sb.Append("],\"od8\":").Append(od8 ? "true" : "false").Append(",\"od8Applied\":").Append(AmdOd8.Applied ? "true" : "false")
              .Append(",\"od8Overridden\":").Append(AmdOd8.Overridden() ? "true" : "false").Append('}');
            Console.Out.WriteLine(sb.ToString());
            if (Environment.GetEnvironmentVariable("VENTO_DEBUG") != null) Console.Error.WriteLine(AmdOd8.CurveNow());
            Console.Out.Flush();
            Thread.Sleep(1000);
        }
    }
}
