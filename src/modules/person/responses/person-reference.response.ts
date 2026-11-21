import componentsPersonModule from './person-components.response';
const { PersonReferenceComponent } = componentsPersonModule;

const PersonReferenceDTO = (reference: Parameters<typeof PersonReferenceComponent.build>[0]) =>
  PersonReferenceComponent.build(reference);

const PersonReferenceListDTO = (reference: Parameters<typeof PersonReferenceComponent.build>[0]) =>
  PersonReferenceComponent.build(reference);

export default { PersonReferenceDTO, PersonReferenceListDTO };
