import railDataJson from "../components/railData.json";

export type RoutePoint = [number, number];

export interface ColoredSegment {
	color: "green" | "red" | "grey";
	points: RoutePoint[];
}

interface RailData {
	knownStations: string[];
	stations: Record<string, number[]>;
	segments: Record<string, string>;
	segmentColors: Record<string, [number, number][]>;
}

const COLOR_NAMES = ["green", "red", "grey"] as const;

const railData = railDataJson as unknown as RailData;

const knownSet = new Set(railData.knownStations);

const EDR_TIMETABLE_URL = "https://simrail-edr.emeraldnetwork.xyz/train";

function normalizeName(name: string): string {
	return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function decodePolyline(str: string): RoutePoint[] {
	let idx = 0;
	let lat = 0;
	let lon = 0;
	const pts: RoutePoint[] = [];
	while (idx < str.length) {
		let shift = 0;
		let result = 0;
		let byte;
		do {
			byte = str.charCodeAt(idx++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);
		lat += result & 1 ? ~(result >> 1) : result >> 1;

		shift = 0;
		result = 0;
		do {
			byte = str.charCodeAt(idx++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);
		lon += result & 1 ? ~(result >> 1) : result >> 1;

		pts.push([lat / 1e5, lon / 1e5]);
	}
	return pts;
}

interface TimetableStop {
	nameOfPoint?: string;
	nameForPerson?: string;
	line?: number;
}

const timetableCache = new Map<string, Promise<TimetableStop[] | null>>();

function cacheSuccessfulResult<T>(
	cache: Map<string, Promise<T | null>>,
	key: string,
	load: () => Promise<T | null>,
): Promise<T | null> {
	const cached = cache.get(key);
	if (cached) return cached;

	const request = load().then(
		(result) => {
			if (result === null) cache.delete(key);
			return result;
		},
		(error) => {
			cache.delete(key);
			throw error;
		},
	);
	cache.set(key, request);
	return request;
}

function fetchTimetable(
	serverCode: string,
	trainNo: string,
): Promise<TimetableStop[] | null> {
	const key = `${serverCode}|${trainNo}`;
	return cacheSuccessfulResult(timetableCache, key, async () => {
		try {
			const response = await fetch(
				`${EDR_TIMETABLE_URL}/${encodeURIComponent(serverCode)}/${encodeURIComponent(trainNo)}`,
			);
			if (!response.ok) return null;
			const timetable: unknown = await response.json();
			return Array.isArray(timetable) && timetable.length > 0
				? (timetable as TimetableStop[])
				: null;
		} catch {
			return null;
		}
	});
}

interface ResolvedStop {
	coord: RoutePoint;
	name: string;
	isKnown: boolean;
	line: number;
}

const routeCache = new Map<string, Promise<ColoredSegment[] | null>>();

export function getTrainRoute(train: {
	ServerCode: string;
	TrainNoLocal: string;
}): Promise<ColoredSegment[] | null> {
	const key = `${train.ServerCode}|${train.TrainNoLocal}`;
	return cacheSuccessfulResult(routeCache, key, () => computeRoute(train));
}

async function computeRoute(train: {
	ServerCode: string;
	TrainNoLocal: string;
}): Promise<ColoredSegment[] | null> {
	const stops = await fetchTimetable(train.ServerCode, train.TrainNoLocal);
	if (!stops || stops.length < 2) return null;

	const resolved: ResolvedStop[] = [];
	for (const stop of stops) {
		const name = stop.nameOfPoint || stop.nameForPerson;
		if (!name) continue;
		const norm = normalizeName(name);
		const coordArr = railData.stations[norm];
		if (!coordArr) continue;
		resolved.push({
			coord: [coordArr[0], coordArr[1]],
			name: norm,
			isKnown: knownSet.has(norm),
			line: stop.line ?? 0,
		});
	}

	let first = -1;
	let last = -1;
	for (let i = 0; i < resolved.length; i++) {
		if (resolved[i].isKnown) {
			if (first < 0) first = i;
			last = i;
		}
	}
	if (first < 0 || last <= first) return null;

	const effective = resolved.slice(first, last + 1);
	if (effective.length < 2) return null;

	const segments: ColoredSegment[] = [];
	let prevConnected = false;

	for (let i = 0; i < effective.length - 1; i++) {
		const a = effective[i];
		const b = effective[i + 1];

		const key = a.name < b.name ? `${a.name}|${b.name}` : `${b.name}|${a.name}`;
		const encoded = railData.segments[key];

		if (!encoded) {
			// Skip grey lines when either stop has line 0 (off the drivable
			// network). These stations often have wrong wiki coordinates
			// (e.g. Koło is misplaced near Łęczyca), creating misleading
			// long grey lines.
			if (a.line === 0 || b.line === 0) {
				prevConnected = false;
				continue;
			}
			// Skip grey lines at the beginning or end of the route —
			// there's nothing to connect to, so they just dangle.
			if (i === 0 || i === effective.length - 2) {
				prevConnected = false;
				continue;
			}
			segments.push({ color: "grey", points: [a.coord, b.coord] });
			prevConnected = false;
			continue;
		}

		const reversed = a.name > b.name;
		const allPts = decodePolyline(encoded);

		const boundaries = railData.segmentColors?.[key] ?? [[0, 0]];

		const subs: {
			color: "green" | "red" | "grey";
			points: RoutePoint[];
		}[] = [];
		for (let bi = 0; bi < boundaries.length; bi++) {
			const [startIdx, colorCode] = boundaries[bi];
			const endIdx =
				bi < boundaries.length - 1 ? boundaries[bi + 1][0] : allPts.length;
			const subPts = allPts.slice(
				startIdx,
				bi < boundaries.length - 1 ? endIdx + 1 : endIdx,
			);
			subs.push({
				color: COLOR_NAMES[colorCode] ?? "grey",
				points: subPts,
			});
		}
		if (reversed) {
			subs.reverse();
			for (const sub of subs) sub.points.reverse();
		}

		for (const { color, points: subPts } of subs) {
			const lastSeg = segments[segments.length - 1];
			if (prevConnected && lastSeg && lastSeg.color === color) {
				lastSeg.points.push(...subPts.slice(1));
			} else {
				segments.push({ color, points: subPts });
			}
			prevConnected = true;
		}
	}

	// Remove backtracks from each segment's polyline. At junctions, the train
	// may go out to a stop and reverse back through the same tracks. When
	// consecutive segments are merged, this creates visible loops on the map
	// (the path revisits the same coordinates). This pass detects duplicate
	// coordinates and removes the out-and-back portion.
	for (const seg of segments) {
		if (seg.color === "grey" || seg.points.length < 4) continue;
		let changed = true;
		while (changed && seg.points.length > 2) {
			changed = false;
			const seen = new Map<string, number>();
			for (let i = 0; i < seg.points.length; i++) {
				const key = `${seg.points[i][0]},${seg.points[i][1]}`;
				const prev = seen.get(key);
				if (prev !== undefined) {
					// Duplicate found: remove the sub-path between the two
					// occurrences (the out-and-back), keeping the first.
					seg.points.splice(prev + 1, i - prev);
					changed = true;
					break;
				}
				seen.set(key, i);
			}
		}
	}

	return segments;
}
