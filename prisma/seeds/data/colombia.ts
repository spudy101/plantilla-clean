// prisma/seeds/data/colombia.ts
//
// Departamentos y ciudades principales de Colombia con códigos DANE oficiales (Divipola).
// Los usa prisma/seeds/geography.seed.ts.

export const DEPARTMENTS: { name: string; daneCode: string }[] = [
  { name: 'Amazonas', daneCode: '91' },
  { name: 'Antioquia', daneCode: '05' },
  { name: 'Arauca', daneCode: '81' },
  { name: 'Atlántico', daneCode: '08' },
  { name: 'Bogotá D.C.', daneCode: '11' },
  { name: 'Bolívar', daneCode: '13' },
  { name: 'Boyacá', daneCode: '15' },
  { name: 'Caldas', daneCode: '17' },
  { name: 'Caquetá', daneCode: '18' },
  { name: 'Casanare', daneCode: '85' },
  { name: 'Cauca', daneCode: '19' },
  { name: 'Cesar', daneCode: '20' },
  { name: 'Chocó', daneCode: '27' },
  { name: 'Córdoba', daneCode: '23' },
  { name: 'Cundinamarca', daneCode: '25' },
  { name: 'Guainía', daneCode: '94' },
  { name: 'Guaviare', daneCode: '95' },
  { name: 'Huila', daneCode: '41' },
  { name: 'La Guajira', daneCode: '44' },
  { name: 'Magdalena', daneCode: '47' },
  { name: 'Meta', daneCode: '50' },
  { name: 'Nariño', daneCode: '52' },
  { name: 'Norte de Santander', daneCode: '54' },
  { name: 'Putumayo', daneCode: '86' },
  { name: 'Quindío', daneCode: '63' },
  { name: 'Risaralda', daneCode: '66' },
  { name: 'San Andrés y Providencia', daneCode: '88' },
  { name: 'Santander', daneCode: '68' },
  { name: 'Sucre', daneCode: '70' },
  { name: 'Tolima', daneCode: '73' },
  { name: 'Valle del Cauca', daneCode: '76' },
  { name: 'Vaupés', daneCode: '97' },
  { name: 'Vichada', daneCode: '99' }
];

// Ciudades principales por departamento (department = nombre del departamento de arriba)
export const CITIES: { name: string; department: string; daneCode: string }[] = [
  // Amazonas
  { name: 'Leticia', department: 'Amazonas', daneCode: '001' },
  { name: 'Puerto Nariño', department: 'Amazonas', daneCode: '530' },
  // Antioquia
  { name: 'Medellín', department: 'Antioquia', daneCode: '001' },
  { name: 'Bello', department: 'Antioquia', daneCode: '088' },
  { name: 'Itagüí', department: 'Antioquia', daneCode: '360' },
  { name: 'Envigado', department: 'Antioquia', daneCode: '266' },
  { name: 'Rionegro', department: 'Antioquia', daneCode: '615' },
  // Arauca
  { name: 'Arauca', department: 'Arauca', daneCode: '001' },
  { name: 'Saravena', department: 'Arauca', daneCode: '736' },
  // Atlántico
  { name: 'Barranquilla', department: 'Atlántico', daneCode: '001' },
  { name: 'Soledad', department: 'Atlántico', daneCode: '758' },
  { name: 'Malambo', department: 'Atlántico', daneCode: '433' },
  // Bogotá D.C.
  { name: 'Bogotá', department: 'Bogotá D.C.', daneCode: '001' },
  // Bolívar
  { name: 'Cartagena', department: 'Bolívar', daneCode: '001' },
  { name: 'Magangué', department: 'Bolívar', daneCode: '430' },
  // Boyacá
  { name: 'Tunja', department: 'Boyacá', daneCode: '001' },
  { name: 'Duitama', department: 'Boyacá', daneCode: '244' },
  { name: 'Sogamoso', department: 'Boyacá', daneCode: '762' },
  // Caldas
  { name: 'Manizales', department: 'Caldas', daneCode: '001' },
  { name: 'Villamaría', department: 'Caldas', daneCode: '877' },
  // Caquetá
  { name: 'Florencia', department: 'Caquetá', daneCode: '001' },
  // Casanare
  { name: 'Yopal', department: 'Casanare', daneCode: '001' },
  // Cauca
  { name: 'Popayán', department: 'Cauca', daneCode: '001' },
  { name: 'Santander de Quilichao', department: 'Cauca', daneCode: '698' },
  // Cesar
  { name: 'Valledupar', department: 'Cesar', daneCode: '001' },
  { name: 'Aguachica', department: 'Cesar', daneCode: '011' },
  // Chocó
  { name: 'Quibdó', department: 'Chocó', daneCode: '001' },
  // Córdoba
  { name: 'Montería', department: 'Córdoba', daneCode: '001' },
  { name: 'Cereté', department: 'Córdoba', daneCode: '162' },
  // Cundinamarca
  { name: 'Soacha', department: 'Cundinamarca', daneCode: '754' },
  { name: 'Facatativá', department: 'Cundinamarca', daneCode: '269' },
  { name: 'Zipaquirá', department: 'Cundinamarca', daneCode: '899' },
  { name: 'Chía', department: 'Cundinamarca', daneCode: '175' },
  { name: 'Mosquera', department: 'Cundinamarca', daneCode: '473' },
  { name: 'Fusagasugá', department: 'Cundinamarca', daneCode: '307' },
  // Guainía
  { name: 'Inírida', department: 'Guainía', daneCode: '001' },
  // Guaviare
  { name: 'San José del Guaviare', department: 'Guaviare', daneCode: '001' },
  // Huila
  { name: 'Neiva', department: 'Huila', daneCode: '001' },
  { name: 'Pitalito', department: 'Huila', daneCode: '551' },
  // La Guajira
  { name: 'Riohacha', department: 'La Guajira', daneCode: '001' },
  { name: 'Maicao', department: 'La Guajira', daneCode: '430' },
  // Magdalena
  { name: 'Santa Marta', department: 'Magdalena', daneCode: '001' },
  { name: 'Ciénaga', department: 'Magdalena', daneCode: '189' },
  // Meta
  { name: 'Villavicencio', department: 'Meta', daneCode: '001' },
  { name: 'Acacías', department: 'Meta', daneCode: '006' },
  // Nariño
  { name: 'Pasto', department: 'Nariño', daneCode: '001' },
  { name: 'Tumaco', department: 'Nariño', daneCode: '835' },
  { name: 'Ipiales', department: 'Nariño', daneCode: '356' },
  // Norte de Santander
  { name: 'Cúcuta', department: 'Norte de Santander', daneCode: '001' },
  { name: 'Ocaña', department: 'Norte de Santander', daneCode: '498' },
  { name: 'Pamplona', department: 'Norte de Santander', daneCode: '518' },
  // Putumayo
  { name: 'Mocoa', department: 'Putumayo', daneCode: '001' },
  // Quindío
  { name: 'Armenia', department: 'Quindío', daneCode: '001' },
  { name: 'Calarcá', department: 'Quindío', daneCode: '130' },
  // Risaralda
  { name: 'Pereira', department: 'Risaralda', daneCode: '001' },
  { name: 'Dosquebradas', department: 'Risaralda', daneCode: '170' },
  { name: 'Santa Rosa de Cabal', department: 'Risaralda', daneCode: '682' },
  // San Andrés y Providencia
  { name: 'San Andrés', department: 'San Andrés y Providencia', daneCode: '001' },
  // Santander
  { name: 'Bucaramanga', department: 'Santander', daneCode: '001' },
  { name: 'Floridablanca', department: 'Santander', daneCode: '276' },
  { name: 'Girón', department: 'Santander', daneCode: '307' },
  { name: 'Piedecuesta', department: 'Santander', daneCode: '547' },
  { name: 'Barrancabermeja', department: 'Santander', daneCode: '081' },
  // Sucre
  { name: 'Sincelejo', department: 'Sucre', daneCode: '001' },
  // Tolima
  { name: 'Ibagué', department: 'Tolima', daneCode: '001' },
  { name: 'Espinal', department: 'Tolima', daneCode: '268' },
  // Valle del Cauca
  { name: 'Cali', department: 'Valle del Cauca', daneCode: '001' },
  { name: 'Palmira', department: 'Valle del Cauca', daneCode: '520' },
  { name: 'Buenaventura', department: 'Valle del Cauca', daneCode: '109' },
  { name: 'Tuluá', department: 'Valle del Cauca', daneCode: '834' },
  { name: 'Cartago', department: 'Valle del Cauca', daneCode: '147' },
  { name: 'Buga', department: 'Valle del Cauca', daneCode: '111' },
  // Vaupés
  { name: 'Mitú', department: 'Vaupés', daneCode: '001' },
  // Vichada
  { name: 'Puerto Carreño', department: 'Vichada', daneCode: '001' }
];
