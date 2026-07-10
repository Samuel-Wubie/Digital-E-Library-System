import React from 'react';
import './ContactUs.css';

export default function ContactUs() {
  return (
    <div className="contact-minimal-page">
      {/* 1. Header Section */}
      <div className="contact-intro">
        <h1>Contact Us</h1>
        <p>Geological Institute of Ethiopia — Main Office & Laboratory</p>
        <div className="gold-separator"></div>
      </div>

      {/* 2. Main Content Grid */}
      <div className="contact-main-grid">
        
        {/* Left Side: Contact Info Sidebar */}
        <div className="info-column">
          <section className="info-block">
            <h3 className="gold-heading">Main Office</h3>
            <p className="black-text">Addis Ababa, Mariam-Mihiret</p>
            <p className="black-text">Ministry of Mines Building</p>
            <span className="gold-postal-box">Post Address: 2302</span>
          </section>

          <section className="info-block">
            <h4 className="gold-subheading">Head Office</h4>
            <p className="black-text">+251-116-46-33-57</p>
            <p className="black-text">+251-938-01-71-44</p>
          </section>

          <section className="info-block">
            <h4 className="gold-subheading">Geo-Science Laboratory</h4>
            <p className="black-text">+251-910-60-99-17</p>
          </section>

          <section className="info-block">
            <h4 className="gold-subheading">Email Address</h4>
            <p className="black-text">info@gie.gov.et</p>
          </section>
        </div>

        {/* Right Side: Message Form Section */}
        <div className="form-column">
          <div className="form-card-white">
            <h3 className="black-text mb-20">Send us a Message</h3>
            <form className="minimal-gold-form">
              <div className="form-group">
                <label>Your Name</label>
                <input type="text" placeholder="John Doe" />
              </div>

              <div className="form-group">
                <label>Email Address</label>
                <input type="email" placeholder="email@example.com" />
              </div>

              <div className="form-group">
                <label>Your Inquiry</label>
                <textarea rows="5" placeholder="Write your message here..."></textarea>
              </div>

              <button type="button" className="gold-action-btn">
                Send Message
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* 3. Social Media Footer Section */}
      <footer className="contact-social-footer">
        <div className="social-divider"></div>
        <h4 className="follow-us-text">Connect with GIE</h4>
        <div className="social-icons-row">
          <a href="https://facebook.com" target="_blank" rel="noreferrer" className="social-link">
            <i className="fab fa-facebook-f"></i>
          </a>
          <a href="https://t.me" target="_blank" rel="noreferrer" className="social-link">
            <i className="fab fa-telegram-plane"></i>
          </a>
          <a href="https://instagram.com" target="_blank" rel="noreferrer" className="social-link">
            <i className="fab fa-instagram"></i>
          </a>
          <a href="https://tiktok.com" target="_blank" rel="noreferrer" className="social-link">
            <i className="fab fa-tiktok"></i>
          </a>
        </div>
      </footer>
    </div>
  );
}