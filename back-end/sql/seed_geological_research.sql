-- ============================================================================
-- Seed: Ethiopian Geological Research reports
-- Target: the existing `books` table (already has title, author, department,
-- location, published_year, page_count, file_path, uploaded_by,
-- download_count columns per back-end/server.js). No new table needed —
-- these rows show up in the existing Library dashboard immediately and are
-- filterable by department using the current department dropdown.
--
-- file_path is left NULL (no PDF attached yet). Attach one later per record
-- via the existing "Edit" -> upload-PDF flow in the Library dashboard, which
-- calls PUT /api/books/:id with a multipart pdfFile field.
--
-- Note: 'Driling' in the original data was a typo, corrected to 'Drilling'.
-- ============================================================================

INSERT INTO books (title, author, department, location, published_year, page_count) VALUES
('Rare Earth Element Potential in Southern Ethiopia', 'Abebe Kebede', 'Geology', 'Hawassa', 1998, 12),
('Mapping Artisanal Gold Mining Sectors Using Remote Sensing', 'Addis Alemayehu', 'Geoscience', 'Addis Ababa', 2002, 12),
('Industrial Mineral Resource Evaluation in the Amhara Region', 'Alem Kebede', 'Geology', 'Gondar', 1985, 12),
('Gemstone Deposits of Ethiopia: A Geological Overview', 'Alemayehu Gelagay', 'Geology', 'Addis Ababa', 2001, 12),
('Hydrogeological Mapping of the Nile Basin Headwaters', 'Bealu Girma', 'Hydrogeology', 'Gondar', 2001, 12),
('Groundwater Salinity and Fluoride Distribution in Rift Aquifers', 'Bitanita Amanuel', 'Hydrogeology', 'Adama', 2003, 12),
('Climate Change Impacts on Ethiopian Aquifer Recharges', 'Efrata Melku', 'Hydrogeology', 'Hawassa', 2002, 12),
('Managed Aquifer Recharge Potential in Arid Ethiopian Regions', 'Eyob Lemma', 'Drilling', 'Mekele', 2007, 12),
('Crustal Thinning and Rifting Dynamics in the Afar Depression', 'Fekade Ephrem', 'Geophysics', 'Adama', 2005, 12),
('Structural Controls on Mineralization in the Arabian-Nubian Shield', 'Gebremichael Keffale', 'Geology', 'Mekele', 2010, 12),
('Fault Line Mapping and Seismic Risk in Addis Ababa', 'Kebede Asfawu', 'Geohazard', 'Addis Ababa', 2005, 12),
('Geodetic Monitoring of Continental Breakup in Ethiopia', 'Lakech Admasu', 'Geophysics', 'Adama', 2001, 12),
('Landslide Susceptibility Mapping in the Ethiopian Highlands', 'Lemlem Chala', 'Geohazard', 'Gondar', 2008, 12),
('Soil Erosion Dynamics and Watershed Management Profiles', 'Mekdes Mulaw', 'Geoscience', 'Hawassa', 2000, 12),
('Environmental Impacts of Mining Activities in Western Ethiopia', 'Mulu Mesfin', 'Geoscience', 'Addis Ababa', 2000, 12),
('Establishing a National Geological Hazard Database for Ethiopia', 'Oliyad Abebe', 'Geohazard', 'Addis Ababa', 2025, 12),
('Mapping Geothermal Potential in the Ethiopian Rift Valley', 'Samuel Wubie', 'Hydrogeology', 'Adama', 2000, 12),
('Volcanic Hazard Assessment of the Main Ethiopian Rift', 'Selam Alemu', 'Geohazard', 'Hawassa', 2003, 12),
('Geochemical Analysis of Thermal Springs in Afar', 'Sisay Chernet', 'Geoscience', 'Adama', 1999, 12),
('Seismic Monitoring Networks of the Ethiopian Geoscience Institute', 'Soliyan Demoz', 'Geophysics', 'Addis Ababa', 2001, 12);
