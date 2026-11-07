import { useEffect, useState, useSyncExternalStore } from 'react';
import './robot.scss';
import { connectToRobot, robot, subscribeToRobot, getRobotUpdateTick, updateRobotStore } from '../logic/connect';
import { type DataKeyData } from '../logic/robot';
import TimeAgo from 'react-timeago';
import { useNavigate } from 'react-router-dom';
import { builtinSlogRead, foreverFullSlogRead, onetimeFullSlogRead } from '../logic/slog';

function Robot() {
    const [status, setStatus] = useState<string>('Not connected');
    const [filterResults, setFilterResults] = useState(false);

    const navigate = useNavigate();
    useEffect(() => {
        if (!('serial' in navigator)) {
            navigate('/unsupported', { replace: true });
        }
    }, [navigate]);

    // Just use the external store to subscribe to a simple "update tick" counter.
    // When 'updateRobotStore()' is called, the tick increases, forcing React to rerender.
    useSyncExternalStore(subscribeToRobot, getRobotUpdateTick);

    if (!robot) return (
        <div className="card connect-robot">
            <span className='title'>Connect your Neato</span>
            <p className="subtitle">
                Remove the dustbin from your Neato vacuum and connect to the USB port.
                Click the button below and select your Neato, It may appear as <strong>"USB Serial Device (COMx)"</strong> on Windows,
                or <strong>"CDC Serial"</strong> / <strong>"ttyACM0"</strong> on Linux/MacOS. You can also try to unplug and replug to device
                to see which one appears if you're not sure.
            </p>

            <div className="toggle-row">
                <label className="switch">
                    <input
                        type="checkbox"
                        checked={filterResults}
                        onChange={() => setFilterResults(!filterResults)}
                    />
                    <span className="slider"></span>
                </label>
                <span className="toggle-label" onClick={() => setFilterResults(!filterResults)}>
                    Filter by Neato device type
                </span>
                <span className="badge">Experimental</span>
            </div>

            <button className="connect" onClick={() => connectToRobot(setStatus, filterResults)}>
                Connect to Robot
            </button>

            <div className="status">Status: {status}</div>
        </div>
    )

    // Easily extract the value now to avoid ? all over the HTML
    const { version, charger, error, testmode, wifistatus } = robot;

    return (
        <div className="info-cards">
            <div className="col">
                <InfoCard title="Version Info" data={version} />
                <InfoCard title="Charger Info" data={charger} />
                <Logs />
            </div>
            <div className="col">
                <InfoCard title="Error Info" data={error} />
                <Actions />
                <InfoCard title="Testmode" data={testmode} />
                <InfoCard title="Wifi Status" data={wifistatus} />
            </div>
        </div>
    )
}

function Logs() {
    if (!robot) return null;
    const { slog } = robot;

    return (
        <div className="card robot-info">
            <div className="info-header">
                <div className="title-group">
                    <h2>Logs</h2>
                </div>
            </div>
            <div className="action-group logs">
                {slog === "" ? (
                    <>
                        <button className="action-btn" onClick={() => robot && builtinSlogRead(robot)}>Basic logfetch - limited in size and speed</button>
                        {robot.canDoAdvancedCommands ? (
                            <>
                                <button className="action-btn" onClick={() => robot && onetimeFullSlogRead(robot)}>Get full log since boot</button>
                                <button className="action-btn" onClick={() => robot && foreverFullSlogRead(robot)}>Get full log since boot + continue fetching forever</button>
                            </>
                        ) : (
                            <p className="no-data">An more advanced logfetch is available if you install your robot with at least 1.1.1-b2 installer!</p>
                        )}
                    </>
                ) : (
                    <>
                        <span>
                            {slog.split('\n').length} lines
                        </span>
                        <button className="action-btn" onClick={() => downloadText(slog, "logs.txt")}>Download</button>
                        <button className="action-btn" onClick={() => { if (robot) robot.slog = ""; updateRobotStore(); }}>Clear log</button>
                        <br />
                        <textarea cols={9999} rows={30} readOnly value={slog}></textarea>

                    </>
                )}
            </div>
        </div>
    )
}

function Actions() {
    if (!robot) return null;

    return (
        <div className="card robot-info">
            <div className="info-header">
                <div className="title-group">
                    <h2>Actions</h2>
                </div>
            </div>
            <div className="action-group logs">
                <button className="action-btn" onClick={() => {
                    if (!robot) return;
                    robot.sendCommand(`TestMode ${robot.testMode ? 'off' : 'on'}`)
                    robot.sendCommand("TestMode")
                }}>Toggle TESTMODE</button>

                {robot.testMode ? (
                    <>
                        <button className="action-btn" onClick={() => robot && robot.sendCommand("SetSystemMode PowerCycle")}>Reboot robot</button>
                        <button className="action-btn" onClick={() => robot && robot.sendCommand("NewBattery")}>NewBattery</button>
                    </>
                ) : (
                    <p className="no-data">More options are available in TestMode</p>
                )}
            </div>
        </div>
    )
}

function InfoCard({ title, data }: { title: string, data: DataKeyData }) {

    const hasData = data.basic.length > 0 || (data.advanced && data.advanced.length > 0);
    const [advancedVisible, setAdvancedVisible] = useState(false);

    return (
        <div className="card robot-info">
            <div className="info-header">
                <div className="title-group">
                    <h2>{title}</h2>
                    <span className="time-ago">Updated: <TimeAgo date={data.lastUpdated} /></span>
                </div>
                <div className="action-group">
                    <button className="action-btn" onClick={() => robot?.sendCommand(data.command)}>Refresh</button>
                    <span className="tooltip-wrap" title={(!data.advanced || data.advanced.length === 0) ? "No advanced data" : undefined}>
                        <button className="action-btn" onClick={() => setAdvancedVisible(v => !v)} disabled={!data.advanced || data.advanced.length === 0}>
                            {advancedVisible ? 'Hide Advanced' : 'Show Advanced'}
                        </button>
                    </span>
                </div>
            </div>
            {!hasData && <p className="no-data">No data received yet.</p>}
            <div className='table'>
                {data.basic.map(([key, value]) => (
                    <div className='row' key={key}>
                        <span className='key'>{key}:</span>
                        <span>{value}</span>
                    </div>
                ))}
                {advancedVisible && data.advanced && data.advanced.map(([key, value]) => (
                    <div className='row' key={key}>
                        <span className='key'>{key}:</span>
                        <span>{value}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default Robot


function downloadText(text: string, name = 'data.txt') {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();

    URL.revokeObjectURL(url);
}