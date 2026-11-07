import { Link } from 'react-router-dom';
import './home.scss';

function Home() {

    return (
        <div className="card home">
            <p className="success">Vacuula Tools</p>
            <p>
                Vacuula allows you to control your robot again, in order to get Vacuula set up please see the <a href="https://github.com/vacuula/vacuula" target="_blank" rel="noopener noreferrer">github for Vacuula</a>.
                <br /> <br />
                
                Vacuula also has this tools package to debug issues on Gen2/Gen3 robots, but also has the Fang (ESP32) flasher for backwards compatibility.
                <br /> <br />

                Use <Link className='nav-btn' to="/robot">Robot Managment</Link> to connect to your robot and view live data or find errors with your device!<br /> <br />

                For furthur information about the project, check out the <a href="https://github.com/vacuula" target="_blank" rel="noopener noreferrer">GitHub</a> where 
                you can find full install guides and everything else you might need!
            </p>
        </div>
    )
}

export default Home
