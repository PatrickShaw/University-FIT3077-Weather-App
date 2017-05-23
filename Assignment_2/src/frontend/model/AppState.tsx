import { MonitoredLocationInformation } from './MonitoredLocationInformation';
import { LocationMetadata } from './LocationMetadata';
import { prefixLocation } from '../prefixLocation';
class AppState {
  public readonly sortedLocations: LocationMetadata[];
  // weatherDataMap is responsible for keeping track of cards to render.
  // Maps locations to MonitoredLocationInformation which has what information needs to be rendered.
  // So weatherDataMap holds all info that a location needs to render for all locations.
  public readonly weatherDataMap: Map<string, MonitoredLocationInformation>;
  // Whether or not the frontend has fully connected to the server
  public readonly connectedToServer: boolean;
  constructor(
    sortedLocations: LocationMetadata[],
    weatherDataMap: Map<string, MonitoredLocationInformation>,
    connectedToServer: boolean
  ) {
    this.sortedLocations = sortedLocations;
    this.weatherDataMap = weatherDataMap;
    this.connectedToServer = connectedToServer;
  }
  
  /**
   * Inserts a location into the location list without breaking the order.
   */
  public static insertServiceLocation(appState: AppState, servicePrefix: string, location: string) {
    // Uses a binary search in an attemp to improve performance.
    let min: number = 0;
    let max: number = appState.sortedLocations.length - 1;
    let mid: number = 0;
    while (min <= max) {
      mid = Math.floor((min + max) / 2);
      const searchedLocation: string = appState.sortedLocations[mid].location;
      if (searchedLocation < location) {
        min = mid + 1;
      } else if (searchedLocation > location) {
        max = mid - 1;
      } else {
        // It already exists but we need to add in our service's prefix.
        appState.sortedLocations[mid].servicePrefixes.add(prefixLocation(servicePrefix, location));
        return;
      }
    }
    // Since the location doesn't exist yet, add it in.
    const locationSet: Set<string> = new Set<string>();
    locationSet.add(prefixLocation(servicePrefix, location));
    appState.sortedLocations.splice(mid + 1, 0, new LocationMetadata(location, locationSet));
  }
}

export {AppState};
export default {AppState};