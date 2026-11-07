import { useNavigate } from 'react-router-dom';
import './unsupported.scss';
import { useEffect } from 'react';

function Unsupported() {

    const navigate = useNavigate();
    useEffect(() => {
        if (('serial' in navigator)) {
            navigate('/', { replace: true });
        }
    }, [navigate]);

    return (
        <div className="card unsupported">
            <p className="warn">Browser not supported</p>
            <p>WebSerial is required for the tools to work.<br />
                Please use a Chromium-based browser like <strong>Chrome</strong>, <strong>Brave</strong>, or <strong>Edge</strong>.</p>
        </div>
    )
}

export default Unsupported
