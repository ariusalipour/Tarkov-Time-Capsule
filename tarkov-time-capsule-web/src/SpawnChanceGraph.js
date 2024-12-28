import React, { useState, useEffect, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale
);

const SpawnChanceGraph = () => {
    const now = new Date();
    const defaultEndDate = new Date(now);
    defaultEndDate.setDate(now.getDate() + 1);
    const defaultStartDate = new Date(now);
    defaultStartDate.setDate(now.getDate() - 7);

    const formatDate = (date) => date.toISOString().split('T')[0];

    const [mapName, setMapName] = useState('');
    const [bossName, setBossName] = useState('');
    const [startDate, setStartDate] = useState(formatDate(defaultStartDate));
    const [endDate, setEndDate] = useState(formatDate(defaultEndDate));
    const [chartData, setChartData] = useState(null);
    const [maxYAxisValue, setMaxYAxisValue] = useState(10000);
    const [capPercentage, setCapPercentage] = useState(false);
    const [bossOptions, setBossOptions] = useState([]);
    const [mapOptions, setMapOptions] = useState([]);
    const yAxisOptions = [10000, 1000, 100, 80, 60, 40, 20];

    // Fetch Boss and Map Options
    useEffect(() => {
        const fetchBosses = async () => {
            try {
                const response = await fetch(`${process.env.REACT_APP_API_URL}api/bosses`);
                if (!response.ok) throw new Error('Failed to fetch bosses');
                const data = await response.json();
                setBossOptions(data); // Assumes data is an array of boss names
            } catch (error) {
                console.error('Error fetching bosses:', error);
            }
        };

        const fetchMaps = async () => {
            try {
                const response = await fetch(`${process.env.REACT_APP_API_URL}api/maps`);
                if (!response.ok) throw new Error('Failed to fetch maps');
                const data = await response.json();
                setMapOptions(data); // Assumes data is an array of map names
            } catch (error) {
                console.error('Error fetching maps:', error);
            }
        };

        fetchBosses();
        fetchMaps();
    }, []);

    const prepareChartData = useCallback(
        (apiData) => {
            if (!apiData) return;

            const shouldGroupByBoss = mapName !== '' || (mapName !== '' && bossName !== '');
            const shouldGroupByMap = bossName !== '' && mapName === '';
            const shouldGroupByBoth = mapName === '' && bossName === '';

            const groupedData = {};

            apiData.forEach((item) => {
                let groupKey = '';

                if (shouldGroupByBoss) {
                    groupKey = item.BossName;
                } else if (shouldGroupByMap) {
                    groupKey = item.MapName;
                } else if (shouldGroupByBoth) {
                    groupKey = `${item.MapName} - ${item.BossName}`;
                }

                if (!groupedData[groupKey]) {
                    groupedData[groupKey] = {
                        label: groupKey,
                        data: [],
                        backgroundColor: `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(
                            Math.random() * 255
                        )}, ${Math.floor(Math.random() * 255)}, 0.5)`,
                        borderColor: `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(
                            Math.random() * 255
                        )}, ${Math.floor(Math.random() * 255)}, 1)`,
                        fill: false,
                    };
                }

                let spawnChancePercentage = item.Chance * 100;
                if (capPercentage && spawnChancePercentage > 100) {
                    spawnChancePercentage = 100;
                }

                groupedData[groupKey].data.push({
                    x: new Date(item.Timestamp),
                    y: spawnChancePercentage,
                });
            });

            setChartData({
                datasets: Object.values(groupedData),
            });
        },
        [mapName, bossName, capPercentage]
    );

    const fetchData = useCallback(async () => {
        try {
            let url = `${process.env.REACT_APP_API_URL}api/spawnchance?`;
            if (mapName) url += `mapName=${mapName}&`;
            if (bossName) url += `bossName=${bossName}&`;
            if (startDate) url += `startDate=${startDate}&`;
            if (endDate) url += `endDate=${endDate}&`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`API request failed with status ${response.status}`);

            const result = await response.json();
            prepareChartData(result);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }, [mapName, bossName, startDate, endDate, prepareChartData]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return (
        <div style={{ backgroundColor: '#121212', color: '#FFFFFF', minHeight: '100vh', padding: '20px' }}>
            <h1>Tarkov Spawn Chance Data</h1>
            <div style={{ marginBottom: '20px' }}>
                <label style={{ marginRight: '15px' }}>
                    Map Name:
                    <select
                        value={mapName}
                        onChange={(e) => setMapName(e.target.value)}
                        style={{ backgroundColor: '#333333', color: '#FFFFFF', marginLeft: '5px' }}
                    >
                        <option value="">Select Map</option>
                        {mapOptions.map((map, index) => (
                            <option key={index} value={map}>
                                {map}
                            </option>
                        ))}
                    </select>
                </label>
                <label style={{ marginRight: '15px' }}>
                    Boss Name:
                    <select
                        value={bossName}
                        onChange={(e) => setBossName(e.target.value)}
                        style={{ backgroundColor: '#333333', color: '#FFFFFF', marginLeft: '5px' }}
                    >
                        <option value="">Select Boss</option>
                        {bossOptions.map((boss, index) => (
                            <option key={index} value={boss}>
                                {boss}
                            </option>
                        ))}
                    </select>
                </label>
                {/* Other input elements */}
            </div>
            {/* Chart and other elements */}
        </div>
    );
};

export default SpawnChanceGraph;
