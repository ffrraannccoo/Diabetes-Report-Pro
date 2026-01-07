
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Activity, Download, Droplets, FileText, TrendingUp, ChevronLeft, AlertCircle, Info, HelpCircle, X, Calendar, Share2, MoreHorizontal, Loader2
} from 'lucide-react';
import Papa from 'papaparse';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, AreaChart, Area, Bar, BarChart,
  ReferenceLine, LabelList, Line, ComposedChart, ReferenceArea, Legend
} from 'recharts';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  format, parse, subDays, subWeeks, subMonths, isWithinInterval, startOfDay, 
  endOfDay, isValid, isAfter, differenceInDays, addWeeks, addMonths, addDays
} from 'date-fns';
import { es } from 'date-fns/locale';

// --- Paleta Clínica ---
const COLORS = {
  veryLow: '#8b0000',
  low: '#fee2e2',
  inRange: '#72c084',
  high: '#ffb347',
  veryHigh: '#e36a6a',
  basal: '#0ea5e9',
  bolusFood: '#4ade80',
  bolusCorr: '#f59e0b',
  bands: {
    veryHigh: 'rgba(227, 106, 106, 0.15)',
    high: 'rgba(255, 179, 71, 0.15)',
    target: 'rgba(114, 192, 132, 0.12)',
    low: 'rgba(254, 226, 226, 0.4)',
    veryLow: 'rgba(139, 0, 0, 0.08)'
  }
};

interface GlucoseEntry { timestamp: Date; value: number; }
interface InsulinEntry { timestamp: Date; units: number; type: 'basal' | 'bolus_food' | 'bolus_correction'; }

interface MetricSummary {
  avg: number;
  gmi: number;
  cv: number;
  tir: { veryLow: number; low: number; range: number; high: number; veryHigh: number; };
  totalPoints: number;
  hypos: number;
  hypers: number;
  label?: string;
}

interface PeriodMetric {
  label: string;
  metrics: MetricSummary;
}

interface ProcessedData {
  patient: string;
  range: { start: Date; end: Date };
  glucose: GlucoseEntry[];
  insulin: InsulinEntry[];
  metrics: MetricSummary;
  comparison: PeriodMetric[];
  hourlyPatterns: any[];
  histogram: any[];
  insulinAnalysis: {
    basalTotal: number;
    bolusFoodTotal: number;
    bolusCorrTotal: number;
    basalAvgPerDay: number;
    ratioBasalBolus: number;
    ratioCorrFood: number;
  };
}

// --- Helpers Robustos ---
const safeDate = (str: string): Date | null => {
  if (!str) return null;
  const clean = str.trim().replace('T', ' ');
  const fmts = [
    'dd-MM-yyyy HH:mm', 'dd/MM/yyyy HH:mm', 'yyyy-MM-dd HH:mm', 
    'd/M/yyyy H:mm', 'dd-MM-yyyy HH:mm:ss', 'dd/MM/yyyy HH:mm:ss',
    'MM-dd-yyyy HH:mm', 'MM/dd/yyyy HH:mm', 'yyyy/MM/dd HH:mm',
    'dd.MM.yyyy HH:mm', 'dd.MM.yyyy HH:mm:ss', 'yyyy-MM-dd HH:mm:ss'
  ];
  for (const f of fmts) {
    try {
      const p = parse(clean, f, new Date());
      if (isValid(p)) return p;
    } catch {}
  }
  const n = new Date(clean);
  return isValid(n) ? n : null;
};

const safeNum = (v: any): number => {
  if (v === null || v === undefined) return NaN;
  const s = v.toString().trim().replace(',', '.');
  const m = s.match(/^-?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : NaN;
};

const getValueByPriority = (row: any, keywords: string[]): any => {
  const rowKeys = Object.keys(row);
  for (const kw of keywords) {
    const normalizeKw = kw.toLowerCase().trim();
    const matchedKey = rowKeys.find(k => k.toLowerCase().trim().includes(normalizeKw));
    if (matchedKey) return row[matchedKey];
  }
  return undefined;
};

// --- Componente Modal Guía ---
const GuideModal = ({ type, onClose }: { type: 'sensor' | 'manual', onClose: () => void }) => {
  const isSensor = type === 'sensor';
  const title = isSensor ? 'Cómo exportar CSV de LibreView' : 'Cómo exportar CSV de MySugr';
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col m-4">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h3 className="text-lg md:text-xl font-black uppercase text-slate-800 flex items-center gap-2">
            <Info size={24} className="text-blue-600 flex-shrink-0"/> <span className="truncate">{title}</span>
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors flex-shrink-0"><X size={24}/></button>
        </div>
        <div className="p-6 md:p-8 space-y-8">
          {isSensor ? (
            <>
              <div className="flex gap-4">
                <div className="bg-blue-100 text-blue-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">1</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Iniciar Sesión</h4>
                  <p className="text-slate-600 text-sm">Ingresa a <a href="https://www.libreview.com" target="_blank" className="text-blue-600 underline">LibreView.com</a> y logueate con tus credenciales.</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="bg-blue-100 text-blue-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">2</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Botón de Descarga</h4>
                  <p className="text-slate-600 text-sm mb-3">Haz clic en el botón <span className="font-bold">"Descargar datos de glucosa"</span> que se encuentra en la esquina superior derecha (o en el menú si estás en móvil).</p>
                  {/* Recreación visual del botón de LibreView */}
                  <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-end">
                      <div className="flex items-center gap-2 text-blue-600 font-bold text-xs md:text-sm bg-blue-50/50 px-3 py-2 rounded hover:bg-blue-100 cursor-default border border-transparent hover:border-blue-200 transition-all">
                        <Download size={16} />
                        Descargar datos de glucosa
                      </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="bg-blue-100 text-blue-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">3</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Confirmar Descarga</h4>
                  <p className="text-slate-600 text-sm mb-3">Haz clic en el botón <span className="font-bold">"Descargar"</span> de la ventana que se abre.</p>
                  {/* Recreación visual del modal de LibreView */}
                  <div className="w-full bg-white border border-slate-200 rounded-lg shadow-sm p-4 max-w-sm">
                      <div className="text-sm font-bold text-slate-800 mb-2">Descargar datos de glucosa</div>
                      <div className="space-y-2 mb-4">
                        <div className="h-2 bg-slate-100 rounded w-full"></div>
                        <div className="h-2 bg-slate-100 rounded w-5/6"></div>
                        <div className="h-2 bg-slate-100 rounded w-4/6"></div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <div className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[10px] md:text-xs font-bold rounded">Cancelar</div>
                        <div className="px-3 py-1.5 bg-blue-500 text-white text-[10px] md:text-xs font-bold rounded shadow-sm shadow-blue-200">Descargar</div>
                      </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="bg-blue-100 text-blue-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">4</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Guardar Archivo</h4>
                  <p className="text-slate-600 text-sm">Guarda el archivo <strong>CSV</strong> en una ubicación que recuerdes o deja que el navegador lo descargue automáticamente en la carpeta "Descargas" de tu computadora o teléfono.</p>
                </div>
              </div>
            </>
          ) : (
            <>
               <div className="flex gap-4">
                <div className="bg-green-100 text-green-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">1</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Pestaña Informes</h4>
                  <p className="text-slate-600 text-sm mb-3">Abre la app y en la pantalla principal ve a la pestaña <span className="font-bold">Informes</span> que se encuentra en la barra inferior.</p>
                  {/* Recreación visual barra inferior MySugr */}
                  <div className="w-full bg-white border-t border-slate-200 p-2 flex justify-around items-center rounded-b-xl shadow-sm max-w-[280px]">
                      <div className="flex flex-col items-center gap-1 opacity-40"><TrendingUp size={20} /><span className="text-[9px] font-bold">Tendencia</span></div>
                      <div className="flex flex-col items-center gap-1 text-[#6c8e1f]"><FileText size={20} /><span className="text-[9px] font-bold">Informe</span></div>
                      <div className="flex flex-col items-center gap-1 opacity-40"><Share2 size={20} /><span className="text-[9px] font-bold">Conexiones</span></div>
                      <div className="flex flex-col items-center gap-1 opacity-40"><MoreHorizontal size={20} /><span className="text-[9px] font-bold">Más</span></div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="bg-green-100 text-green-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">2</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Formato CSV</h4>
                  <p className="text-slate-600 text-sm mb-3">En <span className="font-bold">Formato de archivo</span> toca para cambiar a <span className="font-bold">CSV</span>.</p>
                  <div className="bg-white border border-slate-200 rounded-lg p-4 max-w-xs shadow-sm w-full">
                     <div className="text-slate-500 text-xs font-bold mb-1">Formato de archivo</div>
                     <div className="text-slate-800 font-bold">CSV</div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="bg-green-100 text-green-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">3</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Botón Exportar</h4>
                  <p className="text-slate-600 text-sm mb-3">Haz tap en el botón <span className="font-bold">Exportar</span>. El formato CSV no permite elegir fechas o rangos, descarga toda la información disponible en la app.</p>
                  <div className="w-full max-w-xs">
                    <div className="bg-[#5c7a1a] text-white text-center font-bold py-3 rounded-lg shadow-sm cursor-default">Exportar</div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="bg-green-100 text-green-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">4</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Generando Informe</h4>
                  <p className="text-slate-600 text-sm mb-3">Comenzará la generación del informe. Podemos ver el estado en la barra de notificaciones de nuestro teléfono.</p>
                  {/* Recreación notificación Android MySugr */}
                  <div className="bg-slate-100 rounded-2xl p-4 max-w-xs border border-slate-200 shadow-sm w-full">
                      <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                             <div className="w-5 h-5 bg-[#6c8e1f] rounded-full flex items-center justify-center text-white text-[10px] font-bold">my</div>
                             <div className="text-xs text-slate-600">mySugr • Generando • ahora</div>
                          </div>
                          <ChevronLeft size={12} className="rotate-90 text-slate-400"/>
                      </div>
                      <div className="font-bold text-sm text-slate-900 mb-2">Exportación de informe</div>
                      <div className="h-1 bg-slate-300 rounded-full w-full overflow-hidden mb-3">
                          <div className="h-full bg-slate-500 w-1/3"></div>
                      </div>
                      <div className="text-[#007f7b] font-bold text-xs">Cancelar</div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="bg-green-100 text-green-700 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">5</div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Descargar/Compartir</h4>
                  <p className="text-slate-600 text-sm mb-3">Una vez terminada la descarga recibiremos otra notificación desde dónde podremos Abrir o compartir el CSV generado.</p>
                  {/* Recreación notificación terminada */}
                  <div className="bg-slate-100 rounded-2xl p-4 max-w-xs border border-slate-200 shadow-sm w-full">
                      <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                             <div className="w-5 h-5 bg-[#6c8e1f] rounded-full flex items-center justify-center text-white text-[10px] font-bold">my</div>
                             <div className="text-xs text-slate-600">mySugr • 1 m</div>
                          </div>
                          <ChevronLeft size={12} className="rotate-90 text-slate-400"/>
                      </div>
                      <div className="font-bold text-sm text-slate-900">Exportación de informe</div>
                      <div className="text-sm text-slate-600 mb-4">¡Tu informe está listo!</div>
                      <div className="flex gap-6">
                         <div className="text-[#007f7b] font-bold text-xs">Abrir</div>
                         <div className="text-[#007f7b] font-bold text-xs">Compartir</div>
                      </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-3xl">
          <button onClick={onClose} className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-black transition-colors">Entendido</button>
        </div>
      </div>
    </div>
  );
};

const DiabetesApp = () => {
  const [patientName, setPatientName] = useState('');
  const [sensorFile, setSensorFile] = useState<File | null>(null);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [reportDuration, setReportDuration] = useState<'2w' | '4w' | '2m' | '3m' | '6m' | 'max'>('3m');
  const [data, setData] = useState<ProcessedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeGuide, setActiveGuide] = useState<'sensor' | 'manual' | null>(null);
  const [autoDownload, setAutoDownload] = useState(false);
  
  const pageRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const parseCSV = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = (e) => {
        const content = e.target?.result as string;
        const lines = content.split(/\r?\n/).filter(l => l.trim() !== "");
        const keyTerms = ["timestamp", "fecha", "date", "time", "hora", "glucose", "glucosa", "insulin", "insulina"];
        let bestIdx = 0;
        let maxScore = 0;

        for (let i = 0; i < Math.min(lines.length, 100); i++) {
            const l = lines[i].toLowerCase();
            let score = 0;
            keyTerms.forEach(t => { if(l.includes(t)) score++; });
            if(score > maxScore) { maxScore = score; bestIdx = i; }
        }
        
        if (maxScore === 0) {
             for (let i = 0; i < Math.min(lines.length, 50); i++) {
                if (lines[i].toLowerCase().includes("timestamp") || lines[i].toLowerCase().includes("fecha")) {
                    bestIdx = i; break;
                }
             }
        }

        const csvContent = lines.slice(bestIdx).join("\n");
        Papa.parse(csvContent, {
          header: true, skipEmptyLines: true, dynamicTyping: false,
          complete: (res) => {
            if (res.meta.fields && res.meta.fields.length <= 1) {
              Papa.parse(csvContent, { header: true, delimiter: ";", complete: (r2) => resolve(r2.data), error: reject });
            } else resolve(res.data);
          },
          error: reject
        });
      };
      r.readAsText(file);
    });
  };

  const processAllData = async () => {
    if (!sensorFile || !manualFile) return;
    setLoading(true);
    setError(null);
    try {
      const [data1, data2] = await Promise.all([parseCSV(sensorFile), parseCSV(manualFile)]);
      const allRows = [...data1, ...data2];
      
      const glucoseEntries: GlucoseEntry[] = [];
      const insulinEntries: InsulinEntry[] = [];

      allRows.forEach(row => {
        let ts = safeDate(getValueByPriority(row, ["Device Timestamp", "Timestamp", "Fecha y hora", "Fecha dispositivo", "Date"]));
        if (!ts) {
            const d = getValueByPriority(row, ["Date", "Fecha", "Día"]);
            const t = getValueByPriority(row, ["Time", "Hora"]);
            if (d) ts = safeDate(t ? `${d} ${t}` : d);
        }
        if (!ts) return;

        const gVal = safeNum(getValueByPriority(row, [
            "Historic Glucose", "Glucosa histórica", "Historial glucosa", 
            "Blood Sugar", "Glucosa sanguínea", "Glucosa (mg/dL)", "Resultado", "Medición"
        ]));
        
        if (!isNaN(gVal) && gVal > 0) glucoseEntries.push({ timestamp: ts, value: gVal });

        const basal = safeNum(getValueByPriority(row, ["Basal", "Tresiba", "Insulina (basal)", "Lenta", "Levemir", "Lantus"]));
        if (!isNaN(basal) && basal > 0) insulinEntries.push({ timestamp: ts, units: basal, type: 'basal' });

        const food = safeNum(getValueByPriority(row, ["Food Bolus", "Insulina (alimentos)", "Alimento", "Bolo alimento", "Rápida"]));
        const corr = safeNum(getValueByPriority(row, ["Correction Bolus", "Insulina (corrección)", "Corrección", "Bolo corrección"]));
        const generic = safeNum(getValueByPriority(row, ["Bolus", "Bolo", "Novorapid", "Humalog", "Apidra"]));

        if (!isNaN(food) && food > 0) insulinEntries.push({ timestamp: ts, units: food, type: 'bolus_food' });
        else if (!isNaN(generic) && generic > 0 && (isNaN(corr) || corr === 0)) insulinEntries.push({ timestamp: ts, units: generic, type: 'bolus_food' });
        if (!isNaN(corr) && corr > 0) insulinEntries.push({ timestamp: ts, units: corr, type: 'bolus_correction' });
      });

      const sortedG = glucoseEntries.sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      if (sortedG.length === 0) throw new Error("No se encontraron datos válidos. Verifique los CSV.");

      // --- 1. Definir Rango Global ---
      const lastDate = sortedG[sortedG.length-1].timestamp;
      const end = endOfDay(lastDate);
      let start;

      switch(reportDuration) {
        case '2w': start = startOfDay(subWeeks(end, 2)); break;
        case '4w': start = startOfDay(subWeeks(end, 4)); break;
        case '2m': start = startOfDay(subMonths(end, 2)); break;
        case '3m': start = startOfDay(subMonths(end, 3)); break;
        case '6m': start = startOfDay(subMonths(end, 6)); break;
        case 'max': start = startOfDay(sortedG[0].timestamp); break;
        default: start = startOfDay(subMonths(end, 3));
      }

      const filterG = sortedG.filter(g => isWithinInterval(g.timestamp, {start, end}));
      const filterI = insulinEntries.filter(i => isWithinInterval(i.timestamp, {start, end}));
      
      if (filterG.length === 0) throw new Error(`No hay datos en el rango seleccionado (${reportDuration}).`);

      // --- 2. Generar "Buckets" (Periodos de Comparación) ---
      const comparisonPeriods: {start: Date, end: Date, label: string}[] = [];
      
      if (reportDuration === '2w' || reportDuration === '4w') {
        const weeks = reportDuration === '2w' ? 2 : 4;
        let currentS = start;
        for (let i = 0; i < weeks; i++) {
           const nextS = addWeeks(currentS, 1);
           comparisonPeriods.push({ start: currentS, end: nextS, label: `Sem ${i+1}` });
           currentS = nextS;
        }
      } else if (reportDuration === '2m' || reportDuration === '3m' || reportDuration === '6m') {
        const months = reportDuration === '2m' ? 2 : reportDuration === '3m' ? 3 : 6;
        let currentS = start;
        for (let i = 0; i < months; i++) {
           const nextS = addMonths(currentS, 1);
           comparisonPeriods.push({ start: currentS, end: nextS, label: `Mes ${i+1}` });
           currentS = nextS;
        }
      } else if (reportDuration === 'max') {
        const totalDays = differenceInDays(end, start);
        if (totalDays > 180) {
           // Deciles si > 6 meses
           const stepMs = (end.getTime() - start.getTime()) / 10;
           for (let i = 0; i < 10; i++) {
              comparisonPeriods.push({ 
                 start: new Date(start.getTime() + (stepMs * i)), 
                 end: new Date(start.getTime() + (stepMs * (i+1))), 
                 label: `P${i+1}` 
              });
           }
        } else {
           // Mensual si <= 6 meses
           let currentS = start;
           let i = 1;
           while(currentS < end) {
              const nextS = addMonths(currentS, 1);
              comparisonPeriods.push({ start: currentS, end: nextS > end ? end : nextS, label: `Mes ${i}` });
              currentS = nextS;
              i++;
           }
        }
      }

      const calcMetrics = (gl: GlucoseEntry[]) => {
        const d = gl.length || 1;
        const sum = gl.reduce((s, x) => s + x.value, 0);
        const avg = sum / d;
        const gmi = 3.31 + (0.02392 * avg);
        const sd = Math.sqrt(gl.reduce((s, x) => s + Math.pow(x.value - avg, 2), 0) / d);
        return {
          avg: avg || 0, 
          gmi: avg ? gmi : 0, 
          cv: avg ? (sd / avg) * 100 : 0, 
          totalPoints: gl.length,
          tir: {
            veryLow: (gl.filter(x => x.value < 54).length / d) * 100,
            low: (gl.filter(x => x.value >= 54 && x.value < 70).length / d) * 100,
            range: (gl.filter(x => x.value >= 70 && x.value <= 180).length / d) * 100,
            high: (gl.filter(x => x.value > 180 && x.value <= 250).length / d) * 100,
            veryHigh: (gl.filter(x => x.value > 250).length / d) * 100,
          },
          hypos: gl.filter(x => x.value < 70).length,
          hypers: gl.filter(x => x.value > 250).length
        };
      };

      const finalComparison = comparisonPeriods.map(p => {
          const pData = filterG.filter(g => g.timestamp >= p.start && g.timestamp < p.end);
          return { label: p.label, metrics: calcMetrics(pData) };
      });

      const bT = filterI.filter(i => i.type === 'basal').reduce((s, i) => s + i.units, 0);
      const fT = filterI.filter(i => i.type === 'bolus_food').reduce((s, i) => s + i.units, 0);
      const cT = filterI.filter(i => i.type === 'bolus_correction').reduce((s, i) => s + i.units, 0);

      const patterns = Array.from({length: 24}, (_, h) => {
        const hG = filterG.filter(g => g.timestamp.getHours() === h);
        const hAvg = hG.length ? hG.reduce((s, x) => s + x.value, 0) / hG.length : 0;
        const hSd = hG.length > 1 ? Math.sqrt(hG.reduce((s, x) => s + Math.pow(x.value - hAvg, 2), 0) / hG.length) : 0;
        return {
          hour: h,
          avg: hAvg,
          u: hAvg + hSd,
          l: Math.max(0, hAvg - hSd),
          hypos: hG.filter(x => x.value < 70).length,
          hypers: hG.filter(x => x.value > 250).length,
          tir: hG.length ? (hG.filter(x => x.value >= 70 && x.value <= 180).length / hG.length) * 100 : 0
        };
      });

      const histogram = Array.from({length: 46}, (_, i) => {
        const b = 40 + (i * 10);
        return { bin: b, count: filterG.filter(g => g.value >= b && g.value < b + 10).length };
      });

      const daysDiff = Math.max(1, differenceInDays(end, start));

      setData({
        patient: patientName || 'PACIENTE',
        range: { start, end },
        glucose: filterG,
        insulin: filterI,
        metrics: calcMetrics(filterG),
        comparison: finalComparison,
        hourlyPatterns: patterns,
        histogram,
        insulinAnalysis: {
          basalTotal: bT, bolusFoodTotal: fT, bolusCorrTotal: cT,
          basalAvgPerDay: bT / daysDiff,
          ratioBasalBolus: (bT + fT + cT) > 0 ? (bT / (bT + fT + cT)) * 100 : 0,
          ratioCorrFood: fT > 0 ? cT / fT : 0
        }
      });
      setAutoDownload(true); // Activa la descarga automática
    } catch (e: any) {
      setError(e.message || "Error desconocido al procesar archivos.");
    } finally {
      setLoading(false);
    }
  };

  const generatePDF = async () => {
    const pdf = new jsPDF('l', 'mm', 'a4');
    for (let i = 0; i < pageRefs.length; i++) {
      const r = pageRefs[i].current;
      if (!r) continue;
      const c = await html2canvas(r, { scale: 2, logging: false, useCORS: true });
      if (i > 0) pdf.addPage();
      pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 297, 210);
    }
    pdf.save(`Diabetes_Pro_${data?.patient}.pdf`);
  };

  // Efecto para la descarga automática
  useEffect(() => {
    if (data && autoDownload) {
      const timer = setTimeout(async () => {
        await generatePDF();
        setAutoDownload(false);
      }, 1500); // Espera breve para asegurar que el DOM se renderizó correctamente
      return () => clearTimeout(timer);
    }
  }, [data, autoDownload]);

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 md:p-6 font-inter">
        {activeGuide && <GuideModal type={activeGuide} onClose={() => setActiveGuide(null)} />}
        
        <div className="bg-white p-6 md:p-12 rounded-3xl md:rounded-[3rem] shadow-2xl max-w-4xl w-full border border-slate-200">
          <div className="text-center mb-6 md:mb-10">
            <div className="bg-blue-600 w-16 h-16 md:w-20 md:h-20 rounded-2xl md:rounded-[2rem] flex items-center justify-center text-white mx-auto mb-4 md:mb-6 shadow-xl"><Activity size={32} className="md:w-10 md:h-10"/></div>
            <h1 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase">Diabetes Report Pro</h1>
            <p className="text-slate-500 font-medium mt-2 text-sm md:text-base">Generador de Informes Clínicos Profesionales</p>
          </div>
          {error && <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs md:text-sm font-bold flex items-center gap-2"><AlertCircle size={20}/> {error}</div>}
          
          <div className="space-y-6 md:space-y-8">
            <input type="text" value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="NOMBRE DEL PACIENTE" className="w-full p-4 md:p-6 bg-slate-50 border-2 rounded-2xl md:rounded-3xl font-black text-center text-lg md:text-xl outline-none focus:border-blue-500 transition-all uppercase placeholder:text-slate-300" />
            
            {/* Selector de Rango */}
            <div className="bg-slate-50 p-4 rounded-2xl md:rounded-3xl border-2 border-slate-100">
               <label className="block text-center text-[10px] md:text-xs font-black uppercase text-slate-400 mb-3 tracking-widest">Periodo del Informe</label>
               <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                 {[
                   { id: '2w', label: '2 Semanas' },
                   { id: '4w', label: '4 Semanas' },
                   { id: '2m', label: '2 Meses' },
                   { id: '3m', label: '3 Meses' },
                   { id: '6m', label: '6 Meses' },
                   { id: 'max', label: 'Historial' }
                 ].map(opt => (
                   <button 
                     key={opt.id}
                     onClick={() => setReportDuration(opt.id as any)}
                     className={`py-2 md:py-3 rounded-xl text-[10px] md:text-xs font-bold transition-all uppercase ${reportDuration === opt.id ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-slate-600 hover:bg-slate-200'}`}
                   >
                     {opt.label}
                   </button>
                 ))}
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {/* Input Sensor */}
              <div className="flex flex-col gap-2">
                <label className={`relative p-6 md:p-8 border-4 border-dashed rounded-2xl md:rounded-[2.5rem] flex flex-col items-center gap-3 md:gap-4 cursor-pointer transition-all ${sensorFile ? 'bg-green-50 border-green-500' : 'bg-slate-50 border-slate-200 hover:bg-white'}`}>
                  <input type="file" className="hidden" onChange={e => setSensorFile(e.target.files?.[0] || null)} />
                  <FileText size={32} className={`md:w-10 md:h-10 ${sensorFile ? 'text-green-500' : 'text-slate-300'}`} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-center">{sensorFile ? sensorFile.name : 'ARCHIVO LIBREVIEW (CSV)'}</span>
                </label>
                <button onClick={() => setActiveGuide('sensor')} className="text-blue-500 text-xs font-bold flex items-center justify-center gap-1 hover:underline py-2"><HelpCircle size={14}/> ¿Cómo obtener este archivo?</button>
              </div>

              {/* Input Manual */}
              <div className="flex flex-col gap-2">
                <label className={`relative p-6 md:p-8 border-4 border-dashed rounded-2xl md:rounded-[2.5rem] flex flex-col items-center gap-3 md:gap-4 cursor-pointer transition-all ${manualFile ? 'bg-green-50 border-green-500' : 'bg-slate-50 border-slate-200 hover:bg-white'}`}>
                  <input type="file" className="hidden" onChange={e => setManualFile(e.target.files?.[0] || null)} />
                  <Droplets size={32} className={`md:w-10 md:h-10 ${manualFile ? 'text-green-500' : 'text-slate-300'}`} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-center">{manualFile ? manualFile.name : 'ARCHIVO MYSUGR (CSV)'}</span>
                </label>
                 <button onClick={() => setActiveGuide('manual')} className="text-blue-500 text-xs font-bold flex items-center justify-center gap-1 hover:underline py-2"><HelpCircle size={14}/> ¿Cómo obtener este archivo?</button>
              </div>
            </div>

            <button onClick={processAllData} disabled={loading || !sensorFile || !manualFile} className="w-full bg-slate-900 text-white p-5 md:p-7 rounded-2xl md:rounded-[2.5rem] font-black uppercase tracking-widest shadow-xl flex items-center justify-center gap-4 text-sm md:text-lg hover:bg-black transition-all disabled:bg-slate-100 disabled:text-slate-400">
              {loading ? 'PROCESANDO...' : 'GENERAR REPORTE CLÍNICO'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { metrics, comparison, hourlyPatterns, histogram, glucose, insulinAnalysis } = data;
  const daysAnalyzed = Math.max(1, differenceInDays(data.range.end, data.range.start));

  return (
    <div className="bg-slate-900 min-h-screen p-8 flex flex-col gap-10 overflow-auto no-print relative">
      {/* Overlay de Carga PDF */}
      {autoDownload && (
        <div className="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-sm flex flex-col items-center justify-center text-white animate-in fade-in duration-300">
           <Loader2 size={60} className="animate-spin text-blue-500 mb-6"/>
           <h2 className="text-3xl font-black uppercase tracking-widest">Generando PDF...</h2>
           <p className="text-slate-400 mt-2 font-medium">Por favor espere mientras se prepara su descarga</p>
        </div>
      )}

      <div className="max-w-[1122px] mx-auto w-full flex justify-between bg-white/10 p-4 rounded-2xl backdrop-blur">
        <button onClick={() => setData(null)} className="text-white font-bold flex items-center gap-2 hover:text-blue-400 transition-colors"><ChevronLeft size={20}/> NUEVO ANÁLISIS</button>
        <button onClick={generatePDF} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black flex items-center gap-2 shadow-2xl hover:bg-blue-500 transition-colors"><Download size={20}/> RE-DESCARGAR PDF</button>
      </div>

      {/* HOJA 1: MÉTRICAS E INSULINA */}
      <div ref={pageRefs[0]} className="report-page" id="page-1">
        <div className="flex justify-between items-end border-b-8 border-slate-900 pb-4 mb-10">
            <div>
                 <h1 className="text-4xl font-black uppercase tracking-tight text-slate-900">INFORME DE DIABETES</h1>
                 <p className="text-lg font-bold text-slate-500 uppercase tracking-widest">{data.patient}</p>
            </div>
            <div className="text-right">
                <div className="text-xs font-black uppercase text-slate-400 mb-1">Periodo Analizado</div>
                <div className="text-lg font-black flex items-center gap-2 justify-end">
                    <Calendar size={18} className="text-blue-600"/>
                    {format(data.range.start, 'dd/MM/yyyy')} - {format(data.range.end, 'dd/MM/yyyy')}
                </div>
                <div className="text-xs font-bold text-slate-400 mt-1">({daysAnalyzed} días)</div>
            </div>
        </div>
        
        <div className="grid grid-cols-2 gap-16 flex-grow">
          <div className="space-y-12">
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest mb-6 border-b-2 border-slate-200 pb-2">Métricas Principales</h2>
              <div className="grid grid-cols-2 gap-y-12">
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Promedio Glucosa</p><p className="text-4xl font-black mono">{metrics.avg.toFixed(1)} <span className="text-sm">mg/dL</span></p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">GMI (HbA1c Est.)</p><p className="text-4xl font-black text-blue-600 mono">{metrics.gmi.toFixed(1)}%</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Variabilidad (CV)</p><p className="text-4xl font-black mono">{metrics.cv.toFixed(1)}%</p><p className={`text-[10px] font-black mt-1 ${metrics.cv > 36 ? 'text-red-500' : 'text-green-500'}`}>{metrics.cv > 36 ? '⚠️ ALTA (>36%)' : '✓ ESTABLE'}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Tiempo en Rango</p><p className="text-4xl font-black text-green-600 mono">{metrics.tir.range.toFixed(1)}%</p><p className={`text-[10px] font-black mt-1 ${metrics.tir.range < 70 ? 'text-red-500' : 'text-green-500'}`}>{metrics.tir.range < 70 ? '⚠️ MEJORABLE (<70%)' : '✓ OBJETIVO'}</p></div>
              </div>
            </section>
            
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest mb-6 border-b-2 border-slate-200 pb-2">Distribución de Insulina Total</h2>
              <div className="flex items-center gap-10">
                <div className="w-52 h-52">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie 
                        data={[
                          { name: 'Basal', value: insulinAnalysis.basalTotal },
                          { name: 'Alimento', value: insulinAnalysis.bolusFoodTotal },
                          { name: 'Corrección', value: insulinAnalysis.bolusCorrTotal }
                        ]} 
                        innerRadius={55} 
                        outerRadius={85} 
                        dataKey="value" 
                        stroke="none"
                        isAnimationActive={false}
                      >
                        <Cell fill={COLORS.basal}/><Cell fill={COLORS.bolusFood}/><Cell fill={COLORS.bolusCorr}/>
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-4">
                   <div className="flex justify-between items-center text-[10px] font-black uppercase"><span className="text-sky-500">Basal (Lenta):</span><span>{insulinAnalysis.basalTotal.toFixed(0)} U ({(insulinAnalysis.ratioBasalBolus).toFixed(0)}%)</span></div>
                   <div className="flex justify-between items-center text-[10px] font-black uppercase"><span className="text-green-500">Alimento (Rápida):</span><span>{insulinAnalysis.bolusFoodTotal.toFixed(0)} U</span></div>
                   <div className="flex justify-between items-center text-[10px] font-black uppercase"><span className="text-amber-500">Corrección:</span><span>{insulinAnalysis.bolusCorrTotal.toFixed(0)} U</span></div>
                   <div className="pt-2 border-t border-slate-100 flex justify-between font-black uppercase text-[10px]"><span>Ratio Basal:Bolo</span><span>{insulinAnalysis.ratioBasalBolus.toFixed(0)} : {(100-insulinAnalysis.ratioBasalBolus).toFixed(0)}</span></div>
                </div>
              </div>
            </section>
          </div>
          
          <div className="space-y-12">
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest mb-6 border-b-2 border-slate-200 pb-2">Tiempo en Rango por Categorías</h2>
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart 
                    data={[
                      { n: 'Muy Bajo', v: metrics.tir.veryLow, c: COLORS.veryLow },
                      { n: 'Bajo', v: metrics.tir.low, c: COLORS.low },
                      { n: 'EN RANGO', v: metrics.tir.range, c: COLORS.inRange },
                      { n: 'Alto', v: metrics.tir.high, c: COLORS.high },
                      { n: 'Muy Alto', v: metrics.tir.veryHigh, c: COLORS.veryHigh }
                    ]}
                    isAnimationActive={false}
                  >
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="n" fontSize={9} axisLine={false} tickLine={false} fontStyle="bold" dy={8} />
                    <YAxis hide domain={[0, 100]} />
                    <Bar dataKey="v" radius={[6, 6, 0, 0]} barSize={55}>
                      <LabelList dataKey="v" position="top" formatter={(v:any)=>`${v.toFixed(1)}%`} fontSize={10} fontStyle="bold" />
                      <Cell fill={COLORS.veryLow}/><Cell fill={COLORS.low}/><Cell fill={COLORS.inRange}/><Cell fill={COLORS.high}/><Cell fill={COLORS.veryHigh}/>
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            
            <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 flex flex-col gap-6">
              <div className="flex justify-between items-center">
                <h3 className="text-[10px] font-black uppercase text-slate-400">Balance del Bolo Prandial</h3>
                <span className={`px-3 py-1 rounded-full text-[9px] font-black ${insulinAnalysis.ratioCorrFood > 1 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                   {insulinAnalysis.ratioCorrFood > 1 ? '⚠️ REVISAR RATIOS' : '✓ BALANCE ADECUADO'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div><p className="text-[9px] font-bold text-slate-500 uppercase">Unidades Alimento</p><p className="text-3xl font-black text-green-600 mono">{insulinAnalysis.bolusFoodTotal.toFixed(0)} <span className="text-sm">U</span></p></div>
                <div><p className="text-[9px] font-bold text-slate-500 uppercase">Unidades Corrección</p><p className="text-3xl font-black text-amber-500 mono">{insulinAnalysis.bolusCorrTotal.toFixed(0)} <span className="text-sm">U</span></p></div>
              </div>
              <div className="text-[11px] font-bold text-slate-600 leading-tight border-l-4 border-slate-200 pl-4">
                {insulinAnalysis.ratioCorrFood > 1 
                  ? `Las unidades de corrección superan a las de alimento. Esto sugiere que el ratio Insulina:Carbohidratos podría estar infraestimado.` 
                  : 'Las dosis de corrección son minoritarias frente a las de alimento, indicando una buena aproximación a los ratios prandiales.'}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* HOJA 2: COMPARATIVA */}
      <div ref={pageRefs[1]} className="report-page" id="page-2">
        <h1 className="text-4xl font-black uppercase text-center border-b-8 border-slate-900 pb-4 mb-10 tracking-tight">EVOLUCIÓN TEMPORAL</h1>
        <div className="grid grid-cols-2 grid-rows-2 gap-12 flex-grow">
          {[
            { t: 'Promedio de Glucosa (mg/dL)', k: 'metrics.avg', goal: 154 },
            { t: 'TIR (70-180 mg/dL) (%)', k: 'metrics.tir.range', goal: 70 },
            { t: 'Eventos de Hipoglucemia (<70)', k: 'metrics.hypos' },
            { t: 'Eventos de Hiperglucemia (>250)', k: 'metrics.hypers' }
          ].map((c, i) => (
            <div key={i} className="flex flex-col bg-slate-50/50 p-6 rounded-[2rem] border border-slate-100/50">
              <h3 className="text-[11px] font-black uppercase text-center mb-6 tracking-widest text-slate-400">{c.t}</h3>
              <div className="flex-grow">
                <ResponsiveContainer>
                  <BarChart data={comparison} isAnimationActive={false}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" fontSize={10} fontStyle="bold" axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Bar dataKey={c.k} barSize={comparison.length > 5 ? 30 : 60} radius={[6, 6, 0, 0]}>
                      <LabelList dataKey={c.k} position="top" formatter={(v:any)=>v.toFixed(i<2?1:0)} fontSize={11} fontStyle="bold" />
                      {comparison.map((entry, index) => (
                         <Cell key={`cell-${index}`} fill={`rgba(59, 130, 246, ${0.3 + (index/comparison.length)*0.7})`} />
                      ))}
                    </Bar>
                    {c.goal && <ReferenceLine y={c.goal} stroke="#16a34a" strokeDasharray="8 4" label={{ value: 'Obj', position: 'right', fontSize: 9, fill: '#16a34a', fontStyle: 'bold' }} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* HOJA 3: AGP E HISTOGRAMA */}
      <div ref={pageRefs[2]} className="report-page" id="page-3">
        <h1 className="text-4xl font-black uppercase text-center border-b-8 border-slate-900 pb-4 mb-8 tracking-tight">EVOLUCIÓN Y PERFIL GLUCÉMICO (AGP)</h1>
        <div className="flex flex-col gap-10 flex-grow">
          <div className="h-[400px] bg-white rounded-[3rem] p-6 border-2 border-slate-100 relative overflow-hidden">
            <ResponsiveContainer>
              <ComposedChart data={glucose} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(t) => format(new Date(t), 'dd/MM')} 
                  fontSize={10} 
                  fontStyle="bold"
                  interval={Math.floor(glucose.length / 15)}
                  axisLine={{ stroke: '#cbd5e1' }}
                />
                <YAxis 
                  domain={[40, 450]} 
                  fontSize={10} 
                  fontStyle="bold"
                  axisLine={{ stroke: '#cbd5e1' }}
                  tick={{ fill: '#64748b' }}
                  unit=" mg"
                />
                <Tooltip labelFormatter={(t) => format(new Date(t), 'PPP HH:mm', {locale: es})} />
                
                {/* Zonas de Rango en el Fondo */}
                <ReferenceArea y1={250} y2={450} fill={COLORS.bands.veryHigh} />
                <ReferenceArea y1={180} y2={250} fill={COLORS.bands.high} />
                <ReferenceArea y1={70} y2={180} fill={COLORS.bands.target} />
                <ReferenceArea y1={54} y2={70} fill={COLORS.bands.low} />
                <ReferenceArea y1={40} y2={54} fill={COLORS.bands.veryLow} />

                <ReferenceLine y={180} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="8 4" />
                <ReferenceLine y={70} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="8 4" />
                
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#1e293b" 
                  strokeWidth={1} 
                  dot={false} 
                  isAnimationActive={false}
                  strokeOpacity={0.8}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          
          <div className="flex-grow">
             <h3 className="text-[10px] font-black uppercase text-center mb-4 tracking-widest text-slate-400">Distribución de Valores (Histograma)</h3>
             <div className="h-44">
               <ResponsiveContainer>
                 <BarChart data={histogram} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                   <CartesianGrid vertical={false} stroke="#f1f5f9" />
                   <XAxis dataKey="bin" fontSize={9} fontStyle="bold" axisLine={false} tickLine={false} />
                   <YAxis fontSize={9} fontStyle="bold" axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} width={30} />
                   <Bar dataKey="count" fill="#64748b" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                     <Cell fill="#ef4444" opacity={0.3} /> {/* <70 */}
                     {histogram.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.bin < 70 ? '#ef4444' : entry.bin > 180 ? '#f59e0b' : '#72c084'} />
                     ))}
                   </Bar>
                   <ReferenceLine x={70} stroke="#ef4444" strokeDasharray="5 5" />
                   <ReferenceLine x={180} stroke="#ef4444" strokeDasharray="5 5" />
                   <ReferenceLine 
                    x={metrics.avg} 
                    stroke="#1e293b" 
                    strokeWidth={3} 
                    label={{ value: `MEDIA (${metrics.avg.toFixed(0)})`, position: 'top', fontSize: 11, fontStyle: 'black' }} 
                   />
                 </BarChart>
               </ResponsiveContainer>
             </div>
          </div>
        </div>
      </div>

      {/* HOJA 4: PATRONES CIRCADIANOS */}
      <div ref={pageRefs[3]} className="report-page" id="page-4">
        <h1 className="text-4xl font-black uppercase text-center border-b-8 border-slate-900 pb-4 mb-10 tracking-tight">PATRONES POR HORA DEL DÍA</h1>
        <div className="grid grid-cols-2 grid-rows-2 gap-12 flex-grow">
          <div className="flex flex-col bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100">
            <h3 className="text-[10px] font-black uppercase text-center mb-4 tracking-widest text-slate-400">Glucosa Promedio (mg/dL) con Sombreado SD</h3>
            <ResponsiveContainer>
              <AreaChart data={hourlyPatterns} isAnimationActive={false}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="hour" fontSize={11} fontStyle="bold" axisLine={false} tickLine={false} unit="h" />
                <YAxis domain={[70, 250]} fontSize={11} fontStyle="bold" axisLine={false} tickLine={false} />
                {/* Sombreado de Variabilidad (Promedio +- SD) */}
                <Area type="monotone" dataKey="u" stroke="none" fill="#3b82f6" fillOpacity={0.06} isAnimationActive={false} />
                <Area type="monotone" dataKey="l" stroke="none" fill="#3b82f6" fillOpacity={0.06} isAnimationActive={false} />
                <Area type="monotone" dataKey="avg" stroke="#3b82f6" strokeWidth={3} fill="#3b82f6" fillOpacity={0.15} isAnimationActive={false} />
                <ReferenceLine y={180} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={2} />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100">
            <h3 className="text-[10px] font-black uppercase text-center mb-4 tracking-widest text-slate-400">Eventos de Hipoglucemia por Hora</h3>
            <ResponsiveContainer>
              <BarChart data={hourlyPatterns} isAnimationActive={false}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="hour" fontSize={11} fontStyle="bold" axisLine={false} tickLine={false} unit="h" />
                <Bar dataKey="hypos" fill={COLORS.veryHigh} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100">
            <h3 className="text-[10px] font-black uppercase text-center mb-4 tracking-widest text-slate-400">Hiperglucemias (>250) por Hora</h3>
            <ResponsiveContainer>
              <BarChart data={hourlyPatterns} isAnimationActive={false}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="hour" fontSize={11} fontStyle="bold" axisLine={false} tickLine={false} unit="h" />
                <Bar dataKey="hypers" fill="#f59e0b" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100">
            <h3 className="text-[10px] font-black uppercase text-center mb-4 tracking-widest text-slate-400">Tiempo en Rango (%) por Hora</h3>
            <ResponsiveContainer>
              <BarChart data={hourlyPatterns} isAnimationActive={false}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="hour" fontSize={11} fontStyle="bold" axisLine={false} tickLine={false} unit="h" />
                <YAxis domain={[0, 100]} fontSize={11} fontStyle="bold" axisLine={false} tickLine={false} />
                <Bar dataKey="tir" fill={COLORS.inRange} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="8 4" strokeWidth={2} label={{ value: 'Obj 70%', position: 'right', fontSize: 10, fill: '#ef4444', fontStyle: 'bold' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

const c = document.getElementById('root');
if (c) createRoot(c).render(<DiabetesApp />);
