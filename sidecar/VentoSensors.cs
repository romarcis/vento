// Prints one JSON line per second with all temperature / fan / control sensors.
// Built with the .NET Framework csc (present on every Windows) + LibreHardwareMonitorLib.
using System;
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
            if (!s.Value.HasValue) continue;
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"id\":\"").Append(Esc(s.Identifier.ToString())).Append("\",\"hw\":\"").Append(Esc(h.Name))
              .Append("\",\"name\":\"").Append(Esc(s.Name)).Append("\",\"type\":\"").Append(t)
              .Append("\",\"value\":").Append(s.Value.Value.ToString("0.#", CultureInfo.InvariantCulture)).Append('}');
        }
        foreach (IHardware sub in h.SubHardware) Collect(sub, sb, ref first);
    }

    static int Main() {
        Computer pc = new Computer();
        pc.IsCpuEnabled = true; pc.IsGpuEnabled = true; pc.IsMotherboardEnabled = true;
        pc.IsStorageEnabled = true; pc.IsControllerEnabled = true;
        try { pc.Open(); } catch (Exception e) { Console.Error.WriteLine("open failed: " + e.Message); return 2; }
        UpdateVisitor v = new UpdateVisitor();
        while (true) {
            pc.Accept(v);
            StringBuilder sb = new StringBuilder("{\"sensors\":[");
            bool first = true;
            foreach (IHardware h in pc.Hardware) Collect(h, sb, ref first);
            sb.Append("]}");
            Console.Out.WriteLine(sb.ToString());
            Console.Out.Flush();
            Thread.Sleep(1000);
        }
    }
}
