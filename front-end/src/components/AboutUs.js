import React from 'react';
import './AboutUs.css';

export default function AboutUs() {
  return (
    <div className="about-container-gold">
      {/* Header Section */}
      <div className="about-header">
        <h1>Geological Institute of Ethiopia (GIE)</h1>
        <div className="header-line"></div>
      </div>

      {/* Historical Timeline Section */}
      <section className="about-section">
        <h2 className="section-title-gold">Historical Background</h2>
        <div className="timeline">
          <div className="timeline-item">
            <span className="year">1968</span>
            <p>Established as a department within the Ministry of Mines, Water & Energy.</p>
          </div>
          <div className="timeline-item">
            <span className="year">1982</span>
            <p>Became autonomous as the Ethiopian Institute of Geological Surveys (EIGS).</p>
          </div>
          <div className="timeline-item">
            <span className="year">2000</span>
            <p>Re-established as the Geological Survey of Ethiopia.</p>
          </div>
          <div className="timeline-item highlight">
            <span className="year">2022</span>
            <p>Became the <strong>Geological Institute of Ethiopia</strong> (Proclamation no.1263/2021).</p>
          </div>
        </div>
      </section>

      {/* Vision & Mission Cards */}
      <div className="vision-mission-grid">
        <div className="info-card gold-border">
          <div className="card-icon">🎯</div>
          <h3>Our Vision</h3>
          <p>To facilitate the utilization of geoscience data for developing Ethiopia’s mineral resources and contributing to economic growth.</p>
        </div>
        <div className="info-card gold-border">
          <div className="card-icon">🚀</div>
          <h3>Our Mission</h3>
          <p>To produce high-quality geodata in a format suitable for easy utilization, enabling rapid development of the mining sector.</p>
        </div>
      </div>

      {/* Duties & Objectives Section */}
      <section className="about-section">
        <h2 className="section-title-gold">Duties & Objectives</h2>
        <div className="objectives-grid">
          <div className="obj-item">
            <h4>🗺️ Mapping & Research</h4>
            <p>Preparing geological, Geochemical, and GeoHazard maps with explanatory reports covering the country.</p>
          </div>
          <div className="obj-item">
            <h4>💎 Mineral Exploration</h4>
            <p>Evaluating economic mineral potential through reconnaissance and detailed exploration.</p>
          </div>
          <div className="obj-item">
            <h4>💧 Groundwater & Geothermal</h4>
            <p>Assessing groundwater via hydrogeological maps and exploring geothermal resource potential.</p>
          </div>
          <div className="obj-item">
            <h4>🏗️ Engineering & Hazards</h4>
            <p>Providing geotechnical info for civil works and investigating natural hazards like landslides and volcanic activity.</p>
          </div>
          <div className="obj-item">
            <h4>🧪 Laboratory & Drilling</h4>
            <p>Identify and interpret data from soil, rock, and water samples; carry out deep well geothermal drilling.</p>
          </div>
          <div className="obj-item">
            <h4>📚 Data Dissemination</h4>
            <p>Collect, classify, store, and publish user-oriented geoscience data including museum specimens.</p>
          </div>
        </div>
      </section>
    </div>
  );
}